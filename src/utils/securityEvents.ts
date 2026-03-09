import fs from "node:fs";
import path from "node:path";

// 安全事件类型定义
export type SecurityEventType = "authentication" | "hardware_key" | "password_check" | "session" | "vault";

export type SecurityAction =
  | "login_success"
  | "login_failed"
  | "logout"
  | "register"
  | "key_registered"
  | "key_deleted"
  | "key_authenticated"
  | "breach_detected"
  | "breach_check_passed"
  | "session_created"
  | "session_revoked"
  | "vault_updated"
  | "vault_accessed";

export interface SecurityEvent {
  event_type: SecurityEventType;
  action: SecurityAction;
  user_id?: string;
  session_id?: string;
  device_id?: string;
  ip_address?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// SIEM 配置
interface SIEMConfig {
  enabled: boolean;
  method: "file" | "syslog" | "http";
  filePath?: string;
  syslogHost?: string;
  syslogPort?: number;
  httpEndpoint?: string;
  httpToken?: string;
}

// 从环境变量读取配置
function getSIEMConfig(): SIEMConfig {
  return {
    enabled: process.env.SIEM_ENABLED === "true",
    method: (process.env.SIEM_METHOD as "file" | "syslog" | "http") || "file",
    filePath: process.env.SIEM_FILE_PATH || "/var/log/phase/security.log",
    syslogHost: process.env.SIEM_SYSLOG_HOST,
    syslogPort: parseInt(process.env.SIEM_SYSLOG_PORT || "514", 10),
    httpEndpoint: process.env.SIEM_HTTP_ENDPOINT,
    httpToken: process.env.SIEM_HTTP_TOKEN,
  };
}

/**
 * 记录安全事件
 */
export async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  const config = getSIEMConfig();

  // 始终输出到控制台（用于调试）
  console.log("[SECURITY EVENT]", JSON.stringify(event));

  if (!config.enabled) {
    return;
  }

  try {
    switch (config.method) {
      case "file":
        await logToFile(event, config.filePath!);
        break;
      case "syslog":
        await logToSyslog(event, config.syslogHost!, config.syslogPort!);
        break;
      case "http":
        await logToHTTP(event, config.httpEndpoint!, config.httpToken);
        break;
    }
  } catch (err) {
    console.error("Failed to log security event:", err);
  }
}

/**
 * 写入文件日志
 */
async function logToFile(event: SecurityEvent, filePath: string): Promise<void> {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const logLine = JSON.stringify(event) + "\n";
    fs.appendFileSync(filePath, logLine, "utf-8");
  } catch (err) {
    console.error("Failed to write to log file:", err);
  }
}

/**
 * 发送到 Syslog（简化版本）
 */
async function logToSyslog(event: SecurityEvent, host: string, port: number): Promise<void> {
  // 简化实现 - 生产环境应使用专门的 syslog 库
  // 这里仅作为示例
  console.log(`[SYSLOG] Would send to ${host}:${port}:`, event);
}

/**
 * 发送到 HTTP API
 */
async function logToHTTP(event: SecurityEvent, endpoint: string, token?: string): Promise<void> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      console.error(`Failed to send event to SIEM: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.error("Failed to send event to SIEM HTTP endpoint:", err);
  }
}

/**
 * 辅助函数：创建认证事件
 */
export function createAuthEvent(
  action: "login_success" | "login_failed" | "logout" | "register",
  userId: string,
  ipAddress: string,
  metadata?: Record<string, unknown>,
): SecurityEvent {
  return {
    event_type: "authentication",
    action,
    user_id: userId,
    ip_address: ipAddress,
    timestamp: new Date().toISOString(),
    metadata,
  };
}

/**
 * 辅助函数：创建硬件密钥事件
 */
export function createHardwareKeyEvent(
  action: "key_registered" | "key_deleted" | "key_authenticated",
  userId: string,
  metadata?: Record<string, unknown>,
): SecurityEvent {
  return {
    event_type: "hardware_key",
    action,
    user_id: userId,
    timestamp: new Date().toISOString(),
    metadata,
  };
}

/**
 * 辅助函数：创建密码检查事件
 */
export function createPasswordCheckEvent(
  action: "breach_detected" | "breach_check_passed",
  userId: string,
  metadata?: Record<string, unknown>,
): SecurityEvent {
  return {
    event_type: "password_check",
    action,
    user_id: userId,
    timestamp: new Date().toISOString(),
    metadata,
  };
}

/**
 * 辅助函数：创建会话事件
 */
export function createSessionEvent(
  action: "session_created" | "session_revoked",
  userId: string,
  sessionId: string,
  metadata?: Record<string, unknown>,
): SecurityEvent {
  return {
    event_type: "session",
    action,
    user_id: userId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    metadata,
  };
}
