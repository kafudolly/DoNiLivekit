"""
DoNiChannel 后端入口（FastAPI 版）。

职责：
1. 提供 LiveKit token。
2. 管理语音频道列表。
3. 提供 Presence WebSocket，用于实时同步“谁在线、谁在哪个语音频道”。
4. 兼容旧客户端的 /api/rooms 轮询接口。

注意：
- LiveKit 负责音频、屏幕共享、Track 订阅。
- Presence WebSocket 只负责大厅在线状态和频道成员状态。
- Rust 9001/9002 本地音频采集不经过这里。
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
import uuid
from dataclasses import dataclass
from typing import Dict, List, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from livekit.api import (
    LiveKitAPI,
    AccessToken,
    VideoGrants,
    ListRoomsRequest,
    ListParticipantsRequest,
)


# ============================================================
# 基础配置
# ============================================================

def get_base_dir() -> str:
    """
    返回后端运行目录。

    普通运行时：返回 main.py 所在目录。
    PyInstaller 打包后：返回 exe 所在目录。
    """
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


BASE_DIR = get_base_dir()
DB_PATH = os.path.join(BASE_DIR, "rooms.db")

UI_DIST_DIR = os.path.join(BASE_DIR, "ui", "dist")
UI_SRC_DIR = os.path.join(BASE_DIR, "ui")
UI_DIR = UI_DIST_DIR if os.path.exists(UI_DIST_DIR) else UI_SRC_DIR

API_KEY = os.environ.get("LIVEKIT_API_KEY", "devkey")
API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "secret")
LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "http://127.0.0.1:7880")

DEFAULT_ROOMS = ["day0", "day1", "day2"]
DEFAULT_ROOM_NAME = "team-meeting-room"

app = FastAPI(title="DoNiChannel Backend", version="1.0.1")

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
    """创建 SQLite 连接。"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """初始化语音频道表。"""
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
    """从 SQLite 读取全部语音频道。"""
    conn = get_db_conn()
    try:
        rows = conn.execute("SELECT room_name FROM rooms ORDER BY id ASC").fetchall()
        return [row["room_name"] for row in rows]
    finally:
        conn.close()


def add_room_to_db(room_name: str) -> None:
    """新增语音频道。"""
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
# LiveKit token / rooms 兼容接口
# ============================================================

def build_token(user_name: str, room_name: str, identity: Optional[str] = None) -> str:
    """
    生成 LiveKit 连接 token。

    identity 是 LiveKit 内部唯一身份。
    display name 使用用户输入的 user_name。
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


async def list_livekit_rooms_and_participants() -> dict:
    """
    从 LiveKit 查询当前活跃房间和房间内成员。

    这是旧客户端 /api/rooms 轮询的兼容数据源。
    新客户端实时成员状态应走 /ws/presence。
    """
    result = {}

    async with LiveKitAPI(LIVEKIT_URL, API_KEY, API_SECRET) as lkapi:
        try:
            rooms_resp = await lkapi.room.list_rooms(ListRoomsRequest())
            for room in rooms_resp.rooms:
                parts_resp = await lkapi.room.list_participants(
                    ListParticipantsRequest(room=room.name)
                )
                result[room.name] = [
                    participant.name if participant.name else participant.identity
                    for participant in parts_resp.participants
                ]
        except Exception as error:
            print(f"[rooms] 获取 LiveKit 房间成员失败: {error}")

    return result


# ============================================================
# Presence 状态管理
# ============================================================

@dataclass
class PresenceParticipant:
    """Presence 层在线用户状态。"""
    identity: str
    display_name: str
    current_channel: Optional[str] = None


class PresenceManager:
    """
    管理大厅在线状态和语音频道成员状态。

    只负责 Presence，不负责音频。
    """

    def __init__(self) -> None:
        self.active_connections: Dict[str, WebSocket] = {}
        self.participants: Dict[str, PresenceParticipant] = {}
        self.lock = asyncio.Lock()

    def build_snapshot(self) -> dict:
        """构建完整 Presence 快照。"""
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

    async def connect(self, websocket: WebSocket, identity: str, display_name: str) -> bool:
        """
        注册 Presence WebSocket 连接。

        修复点：
        - 同一 identity 重连时，新连接替换旧连接。
        - 旧连接断开时不能误删新连接。
        - accept 后、发送 snapshot 前客户端可能已经断开，必须捕获异常。
        """
        try:
            await websocket.accept()
        except Exception as error:
            print(f"[presence] WebSocket accept 失败: identity={identity}, error={error}")
            return False

        old_websocket = None
        was_online = False
        old_channel = None

        async with self.lock:
            old_websocket = self.active_connections.get(identity)
            old_participant = self.participants.get(identity)

            if old_participant:
                was_online = True
                old_channel = old_participant.current_channel

            self.active_connections[identity] = websocket
            self.participants[identity] = PresenceParticipant(
                identity=identity,
                display_name=display_name,
                current_channel=old_channel,
            )

        if old_websocket and old_websocket is not websocket:
            try:
                await old_websocket.close(code=4000)
            except Exception:
                pass

        try:
            await websocket.send_text(
                json.dumps(self.build_snapshot(), ensure_ascii=False)
            )
        except Exception as error:
            print(
                f"[presence] 发送初始快照失败，按正常断开处理: "
                f"identity={identity}, error={error}"
            )
            await self.disconnect(identity, websocket)
            return False

        if not was_online:
            await self.broadcast(
                {
                    "type": "participant_online",
                    "participant": {
                        "identity": identity,
                        "displayName": display_name,
                        "currentChannel": old_channel,
                    },
                },
                exclude_identity=identity,
            )

        return True

    async def disconnect(self, identity: str, websocket: Optional[WebSocket] = None) -> None:
        """
        注销 Presence 连接。

        如果断开的是旧连接，而 active_connections[identity] 已经是新连接，
        则直接忽略，不能误删新连接。
        """
        async with self.lock:
            current_websocket = self.active_connections.get(identity)

            if websocket is not None and current_websocket is not websocket:
                return

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
        """把用户移动到指定语音频道。"""
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
        """频道创建后广播完整快照。"""
        await self.broadcast(self.build_snapshot())

    async def send_to(self, identity: str, payload: dict) -> bool:
        """向指定用户发送 Presence 消息；失败则清理连接。"""
        websocket = self.active_connections.get(identity)
        if not websocket:
            return False

        try:
            await websocket.send_text(json.dumps(payload, ensure_ascii=False))
            return True
        except Exception as error:
            print(f"[presence] 向客户端发送消息失败，清理连接: identity={identity}, error={error}")
            await self.disconnect(identity, websocket)
            return False

    async def broadcast(self, payload: dict, exclude_identity: Optional[str] = None) -> None:
        """
        向所有在线 Presence 客户端广播消息。

        发送失败时，带具体 websocket 清理，避免旧连接失败误删新连接。
        """
        message = json.dumps(payload, ensure_ascii=False)
        dead_connections = []

        for identity, websocket in list(self.active_connections.items()):
            if exclude_identity and identity == exclude_identity:
                continue

            try:
                await websocket.send_text(message)
            except Exception:
                dead_connections.append((identity, websocket))

        for identity, websocket in dead_connections:
            await self.disconnect(identity, websocket)


presence_manager = PresenceManager()


# ============================================================
# HTTP API
# ============================================================

@app.get("/")
async def index():
    """返回前端入口文件。"""
    index_path = os.path.join(UI_DIR, "index.html")
    if not os.path.exists(index_path):
        raise HTTPException(status_code=404, detail=f"未找到前端入口文件: {index_path}")
    return FileResponse(index_path)


@app.get("/api/get_token")
@app.get("/token")
async def get_token(
    user: str = "访客",
    room: str = DEFAULT_ROOM_NAME,
    identity: Optional[str] = None,
):
    """获取 LiveKit token。"""
    token_jwt = build_token(user_name=user, room_name=room, identity=identity)
    return {"token": token_jwt, "room": room}


@app.get("/api/rooms")
async def get_rooms():
    """
    获取频道列表和当前频道成员。

    旧客户端兼容：participants 从 LiveKit 查询。
    新客户端实时成员状态走 Presence WebSocket。
    """
    db_rooms = get_all_rooms_from_db()
    livekit_map = {}

    try:
        livekit_map = await list_livekit_rooms_and_participants()
    except Exception as error:
        print(f"[rooms] LiveKit room sync failed: {error}")

    merged_names = []
    seen = set()
    for name in db_rooms + list(livekit_map.keys()):
        if name in seen:
            continue
        seen.add(name)
        merged_names.append(name)

    payload = [
        {
            "name": name,
            "participants": livekit_map.get(name, []),
        }
        for name in merged_names
    ]

    return JSONResponse(payload)


@app.post("/api/rooms")
async def create_room(body: dict = Body(default_factory=dict)):
    """创建语音频道。"""
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

    前端消息：
    - {"type":"join_channel", "channelId":"day0"}
    - {"type":"leave_channel"}
    - {"type":"request_snapshot"}
    - {"type":"ping"}
    """
    user = websocket.query_params.get("user", "访客").strip() or "访客"
    identity = websocket.query_params.get("identity")

    if not identity:
        identity = f"{user}-{uuid.uuid4().hex[:8]}"

    connected = await presence_manager.connect(
        websocket,
        identity=identity,
        display_name=user,
    )

    if not connected:
        return

    try:
        while True:
            raw_message = await websocket.receive_text()

            try:
                message = json.loads(raw_message)
            except json.JSONDecodeError:
                await presence_manager.send_to(
                    identity,
                    {
                        "type": "error",
                        "message": "Presence 消息不是合法 JSON",
                        "raw": raw_message,
                    },
                )
                continue

            message_type = message.get("type")

            if message_type == "ping":
                await presence_manager.send_to(identity, {"type": "pong"})

            elif message_type == "join_channel":
                channel_id = message.get("channelId")
                try:
                    await presence_manager.move_to_channel(identity, channel_id)
                except ValueError as error:
                    await presence_manager.send_to(
                        identity,
                        {
                            "type": "error",
                            "message": str(error),
                            "action": "join_channel",
                        },
                    )

            elif message_type == "leave_channel":
                await presence_manager.move_to_channel(identity, None)

            elif message_type == "request_snapshot":
                await presence_manager.send_to(identity, presence_manager.build_snapshot())

            else:
                await presence_manager.send_to(
                    identity,
                    {
                        "type": "error",
                        "message": f"未知 Presence 消息类型: {message_type}",
                    },
                )

    except WebSocketDisconnect:
        await presence_manager.disconnect(identity, websocket)

    except RuntimeError as error:
        error_text = str(error)
        if "WebSocket is not connected" in error_text:
            await presence_manager.disconnect(identity, websocket)
            return

        print(f"[presence] WebSocket 运行时异常: identity={identity}, error={error}")
        await presence_manager.disconnect(identity, websocket)

    except Exception as error:
        print(f"[presence] WebSocket 异常: identity={identity}, error={error}")
        await presence_manager.disconnect(identity, websocket)


# ============================================================
# 静态资源兜底
# ============================================================

assets_dir = os.path.join(UI_DIR, "assets")
if os.path.exists(assets_dir):
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


# ============================================================
# 本地启动入口
# ============================================================

def run_server() -> None:
    """
    启动 FastAPI 后端服务。

    PyInstaller 打包后必须直接传 app 对象，不能使用 "main:app" 字符串。
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
