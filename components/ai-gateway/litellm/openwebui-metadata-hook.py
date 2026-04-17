"""LiteLLM custom logger: maps OpenWebUI forwarded headers to Langfuse metadata.

Reads these request headers (sent by OpenWebUI when ENABLE_FORWARD_USER_INFO_HEADERS=true):
  - X-OpenWebUI-User-Email -> trace_user_id
  - X-OpenWebUI-User-Name  -> user_name
  - X-OpenWebUI-User-Role  -> tag: role:<value>
  - X-OpenWebUI-Chat-Id    -> session_id

Registered via litellm_settings.callbacks: ["openwebui_metadata_hook.instance"]
"""

from typing import Any, Dict, Optional

from litellm.integrations.custom_logger import CustomLogger


class OpenWebUIMetadataHook(CustomLogger):
    async def async_pre_call_hook(
        self,
        user_api_key_dict: Any,
        cache: Any,
        data: Dict[str, Any],
        call_type: str,
    ) -> Optional[Dict[str, Any]]:
        headers: Dict[str, Any] = data.get("proxy_server_request", {}).get("headers", {}) or {}
        # FastAPI lowercases headers
        def h(name: str) -> Optional[str]:
            return headers.get(name.lower()) or headers.get(name)

        email = h("x-openwebui-user-email")
        name = h("x-openwebui-user-name")
        role = h("x-openwebui-user-role")
        chat_id = h("x-openwebui-chat-id")

        if not any([email, name, role, chat_id]):
            return data

        metadata = data.get("metadata") or {}
        if email:
            metadata["trace_user_id"] = email
            data["user"] = email
        if name:
            metadata["user_name"] = name
        if chat_id:
            metadata["session_id"] = chat_id
            metadata["trace_session_id"] = chat_id
        tags = list(metadata.get("tags") or [])
        if role:
            tags.append(f"role:{role}")
        if email and "@" in email:
            tags.append(f"domain:{email.split('@', 1)[1]}")
        if tags:
            metadata["tags"] = tags
        data["metadata"] = metadata
        return data


instance = OpenWebUIMetadataHook()
