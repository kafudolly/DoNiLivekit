"""
DoNiChannel 后端入口。

当前职责：
1. 提供 LiveKit token。
2. 管理语音频道列表。
3. 提供 Presence WebSocket，用于实时同步“谁在线、谁在哪个语音频道”。
4. 在需要时提供前端静态文件。

说明：
- LiveKit 仍然负责音频、屏幕共享、Track 订阅。
- Presence WebSocket 只负责大厅在线状态和频道成员状态。
- Rust 9001/9002 本地音频采集不经过这里。
"""

import asyncio
import json
import os
import sqlite3
import sys
import uuid
from dataclasses import dataclass
from typing import Dict, List, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from livekit.api import AccessToken, VideoGrants


# ============================================================
# 基础配置
# ============================================================

def get_base_dir() -> str:
    """
    返回后端运行目录。

    普通运行时：返回 app.py 所在目录。
    PyInstaller 打包后：返回 exe 所在目录。

    这样 rooms.db、ui/dist 等路径在源码运行和 exe 运行时都比较稳定。
    """
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


BASE_DIR = get_base_dir()
DB_PATH = os.path.join(BASE_DIR, "rooms.db")

# 如果已经执行 npm run build，优先使用 ui/dist。
# 如果还在开发阶段，则保底使用 ui 目录。
UI_DIST_DIR = os.path.join(BASE_DIR, "ui", "dist")
UI_SRC_DIR = os.path.join(BASE_DIR, "ui")
UI_DIR = UI_DIST_DIR if os.path.exists(UI_DIST_DIR) else UI_SRC_DIR

API_KEY = os.environ.get("LIVEKIT_API_KEY", "devkey")
API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "secret")
LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "http://127.0.0.1:7880")

DEFAULT_ROOMS = ["day0", "day1", "day2"]
DEFAULT_ROOM_NAME = "team-meeting-room"


app = FastAPI(title="DoNiChannel Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# SQLite 房间存储
# ============================================================

def get_db_conn() -> sqlite3.Connection:
    """
    创建 SQLite 连接。

    row_factory 用于让查询结果可以按字段名访问，例如 row["room_name"]。
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """
    初始化语音频道表。

    如果数据库为空，则写入默认频道 day0/day1/day2。
    """
    conn = get_db_conn()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_name TEXT NOT NULL UNIQUE
            )
            """
        )

        count = conn.execute("SELECT COUNT(*) AS cnt FROM rooms").fetchone()["cnt"]
        if count == 0:
            conn.executemany(
                "INSERT OR IGNORE INTO rooms (room_name) VALUES (?)",
                [(name,) for name in DEFAULT_ROOMS],
            )

        conn.commit()
    finally:
        conn.close()


def get_all_rooms_from_db() -> List[str]:
    """
    从 SQLite 读取全部语音频道。

    注意：这个函数只返回频道列表，不再负责实时成员状态。
    实时成员状态由 PresenceManager 维护。
    """
    conn = get_db_conn()
    try:
        rows = conn.execute("SELECT room_name FROM rooms ORDER BY id ASC").fetchall()
        return [row["room_name"] for row in rows]
    finally:
        conn.close()


def add_room_to_db(room_name: str) -> None:
    """
    新增语音频道。

    INSERT OR IGNORE 可以避免重复创建同名频道时报错。
    """
    conn = get_db_conn()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO rooms (room_name) VALUES (?)",
            (room_name,),
        )
        conn.commit()
    finally:
        conn.close()


init_db()


# ============================================================
# LiveKit token
# ============================================================

def build_token(user_name: str, room_name: str, identity: Optional[str] = None) -> str:
    """
    生成 LiveKit 连接 token。

    identity 是 LiveKit 内部唯一身份。
    displayName 是 UI 上显示的名字。

    如果没有传 identity，则自动生成一个短随机后缀，避免同名用户冲突。
    """
    clean_user = (user_name or "访客").strip() or "访客"
    clean_room = (room_name or DEFAULT_ROOM_NAME).strip() or DEFAULT_ROOM_NAME

    livekit_identity = identity or f"{clean_user}-{uuid.uuid4().hex[:8]}"

    token = (
        AccessToken(API_KEY, API_SECRET)
        .with_identity(livekit_identity)
        .with_name(clean_user)
        .with_grants(
            VideoGrants(
                room_join=True,
                room=clean_room,
            )
        )
    )

    return token.to_jwt()


# ============================================================
# Presence 状态管理
# ============================================================

@dataclass
class PresenceParticipant:
    """
    Presence 层的在线用户状态。

    identity:
        当前连接的唯一 ID。可以和 LiveKit identity 保持一致。

    display_name:
        UI 显示名，例如 rain、黄前久美子。

    current_channel:
        用户当前所在语音频道。进入大厅但未进频道时为 None。
    """

    identity: str
    display_name: str
    current_channel: Optional[str] = None


class PresenceManager:
    """
    管理大厅在线状态和语音频道成员状态。

    它只负责 Presence，不负责音频。
    音频、屏幕共享、远端 Track 仍然交给 LiveKit。
    """

    def __init__(self) -> None:
        self.active_connections: Dict[str, WebSocket] = {}
        self.participants: Dict[str, PresenceParticipant] = {}
        self.lock = asyncio.Lock()

    def build_snapshot(self) -> dict:
        """
        构建完整 Presence 快照。

        前端首次连接和断线重连后，都应该使用 snapshot 覆盖本地状态，
        避免因为断线期间漏掉增量事件导致状态错乱。
        """
        room_names = get_all_rooms_from_db()

        channels = []
        for room_name in room_names:
            members = [
                {
                    "identity": participant.identity,
                    "displayName": participant.display_name,
                }
                for participant in self.participants.values()
                if participant.current_channel == room_name
            ]

            channels.append(
                {
                    "id": room_name,
                    "name": room_name,
                    "type": "voice",
                    "members": members,
                }
            )

        participants = {
            identity: {
                "identity": participant.identity,
                "displayName": participant.display_name,
                "currentChannel": participant.current_channel,
            }
            for identity, participant in self.participants.items()
        }

        return {
            "type": "presence_snapshot",
            "channels": channels,
            "participants": participants,
        }

    async def connect(self, websocket: WebSocket, identity: str, display_name: str) -> None:
        """
        注册一个 Presence WebSocket 连接。

        连接成功后立刻发送完整快照，并向其他客户端广播用户进入大厅。
        """
        await websocket.accept()

        async with self.lock:
            self.active_connections[identity] = websocket
            self.participants[identity] = PresenceParticipant(
                identity=identity,
                display_name=display_name,
                current_channel=None,
            )

        await self.send_to(identity, self.build_snapshot())

        await self.broadcast(
            {
                "type": "participant_online",
                "participant": {
                    "identity": identity,
                    "displayName": display_name,
                    "currentChannel": None,
                },
            },
            exclude_identity=identity,
        )

    async def disconnect(self, identity: str) -> None:
        """
        注销一个 Presence 连接。

        用户关闭窗口、断网、刷新页面时都会走这里。
        必须把用户从频道成员中清掉，避免频道下面残留幽灵用户。
        """
        async with self.lock:
            participant = self.participants.pop(identity, None)
            self.active_connections.pop(identity, None)

        if participant:
            await self.broadcast(
                {
                    "type": "participant_offline",
                    "identity": participant.identity,
                    "displayName": participant.display_name,
                    "from": participant.current_channel,
                }
            )

    async def move_to_channel(self, identity: str, channel_id: Optional[str]) -> None:
        """
        把用户移动到指定语音频道。

        channel_id 为 None 或空字符串时，表示用户离开语音频道但仍在大厅。
        """
        clean_channel = (channel_id or "").strip() or None

        if clean_channel is not None and clean_channel not in get_all_rooms_from_db():
            raise ValueError(f"频道不存在: {clean_channel}")

        async with self.lock:
            participant = self.participants.get(identity)
            if not participant:
                raise ValueError(f"Presence 用户不存在: {identity}")

            old_channel = participant.current_channel
            participant.current_channel = clean_channel

            payload = {
                "type": "participant_moved",
                "identity": participant.identity,
                "displayName": participant.display_name,
                "from": old_channel,
                "to": clean_channel,
            }

        await self.broadcast(payload)

    async def broadcast_room_created(self, room_name: str) -> None:
        """
        频道创建后广播完整快照。

        频道结构变化不频繁，直接广播 snapshot 更简单可靠。
        """
        await self.broadcast(self.build_snapshot())

    async def send_to(self, identity: str, payload: dict) -> None:
        """
        向指定用户发送 Presence 消息。

        发送失败时不在这里直接删除连接，
        断开清理统一交给 WebSocketDisconnect 分支。
        """
        websocket = self.active_connections.get(identity)
        if not websocket:
            return

        await websocket.send_text(json.dumps(payload, ensure_ascii=False))

    async def broadcast(self, payload: dict, exclude_identity: Optional[str] = None) -> None:
        """
        向所有在线 Presence 客户端广播消息。

        exclude_identity 用于避免把某些事件重复发给事件发起者。
        """
        message = json.dumps(payload, ensure_ascii=False)

        dead_connections = []

        for identity, websocket in list(self.active_connections.items()):
            if exclude_identity and identity == exclude_identity:
                continue

            try:
                await websocket.send_text(message)
            except Exception:
                dead_connections.append(identity)

        for identity in dead_connections:
            await self.disconnect(identity)


presence_manager = PresenceManager()


# ============================================================
# HTTP API
# ============================================================

@app.get("/")
async def index():
    """
    返回前端入口文件。

    Tauri 开发模式下通常走 Vite 5173；
    这个路由主要用于浏览器直接访问后端或打包部署时兜底。
    """
    index_path = os.path.join(UI_DIR, "index.html")

    if not os.path.exists(index_path):
        raise HTTPException(
            status_code=404,
            detail=f"未找到前端入口文件: {index_path}",
        )

    return FileResponse(index_path)


@app.get("/api/get_token")
@app.get("/token")
async def get_token(user: str = "访客", room: str = DEFAULT_ROOM_NAME, identity: Optional[str] = None):
    """
    获取 LiveKit token。

    前端进入某个语音频道前会调用这个接口。
    identity 可选；如果前端已经有 Presence identity，可以传进来保持一致。
    """
    token_jwt = build_token(user_name=user, room_name=room, identity=identity)
    return {"token": token_jwt, "room": room}


@app.get("/api/rooms")
async def get_rooms():
    """
    获取频道列表。

    重要：
    这个接口以后只负责“有哪些频道”，不再作为实时成员状态来源。
    实时成员状态由 /ws/presence 推送。
    """
    rooms = get_all_rooms_from_db()
    snapshot = presence_manager.build_snapshot()

    channel_map = {channel["id"]: channel for channel in snapshot["channels"]}

    # 为了兼容当前前端，暂时仍返回 participants 字段。
    # 后续前端接入 /ws/presence 后，可以不再依赖这个字段。
    payload = [
        {
            "name": room_name,
            "participants": [
                member["displayName"]
                for member in channel_map.get(room_name, {}).get("members", [])
            ],
        }
        for room_name in rooms
    ]

    return JSONResponse(payload)


@app.post("/api/rooms")
async def create_room(body: dict):
    """
    创建语音频道。

    创建成功后广播 Presence 快照，让已连接大厅的客户端立即看到新频道。
    """
    room_name = str(body.get("name") or body.get("room_name") or "").strip()

    if not room_name:
        raise HTTPException(status_code=400, detail="房间名不能为空")

    if len(room_name) > 64:
        raise HTTPException(status_code=400, detail="房间名过长，最多 64 个字符")

    add_room_to_db(room_name)
    await presence_manager.broadcast_room_created(room_name)

    return {"ok": True, "name": room_name}


# ============================================================
# Presence WebSocket
# ============================================================

@app.websocket("/ws/presence")
async def presence_websocket(websocket: WebSocket):
    """
    Presence WebSocket 入口。

    连接参数：
    ws://host:5000/ws/presence?user=rain&identity=rain-a1b2c3d4

    前端发送的消息示例：
    {"type": "join_channel", "channelId": "day0"}
    {"type": "leave_channel"}
    {"type": "ping"}

    后端推送：
    presence_snapshot
    participant_online
    participant_offline
    participant_moved
    pong
    error
    """
    user = websocket.query_params.get("user", "访客").strip() or "访客"
    identity = websocket.query_params.get("identity")

    if not identity:
        identity = f"{user}-{uuid.uuid4().hex[:8]}"

    await presence_manager.connect(websocket, identity=identity, display_name=user)

    try:
        while True:
            raw_message = await websocket.receive_text()

            try:
                message = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "message": "Presence 消息不是合法 JSON",
                            "raw": raw_message,
                        },
                        ensure_ascii=False,
                    )
                )
                continue

            message_type = message.get("type")

            if message_type == "ping":
                await websocket.send_text(
                    json.dumps({"type": "pong"}, ensure_ascii=False)
                )

            elif message_type == "join_channel":
                channel_id = message.get("channelId")
                try:
                    await presence_manager.move_to_channel(identity, channel_id)
                except ValueError as error:
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "error",
                                "message": str(error),
                                "action": "join_channel",
                            },
                            ensure_ascii=False,
                        )
                    )

            elif message_type == "leave_channel":
                await presence_manager.move_to_channel(identity, None)

            elif message_type == "request_snapshot":
                await presence_manager.send_to(identity, presence_manager.build_snapshot())

            else:
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "message": f"未知 Presence 消息类型: {message_type}",
                        },
                        ensure_ascii=False,
                    )
                )

    except WebSocketDisconnect:
        await presence_manager.disconnect(identity)

    except Exception as error:
        print(f"[presence] WebSocket 异常: identity={identity}, error={error}")
        await presence_manager.disconnect(identity)


# ============================================================
# 静态资源兜底
# ============================================================

if os.path.exists(UI_DIR):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(UI_DIR, "assets")),
        name="assets",
    ) if os.path.exists(os.path.join(UI_DIR, "assets")) else None


def run_server() -> None:
    """
    启动 FastAPI 后端服务。

    打包成 exe 后，不能使用 "app:app" 或 "main:app" 这种字符串导入方式，
    否则 uvicorn 可能找不到模块并直接闪退。
    """
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=5000,
        reload=False,
    )


if __name__ == "__main__":
    import multiprocessing

    multiprocessing.freeze_support()
    run_server()