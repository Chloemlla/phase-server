# 安全增强功能实现

本文档描述了后端实现的安全增强功能。

## 已实现功能

### 1. WebAuthn / 硬件密钥支持 ✅

支持 YubiKey、Google Titan 等 FIDO2 硬件密钥。

**API 端点：**
- `POST /api/v1/webauthn/register/begin` - 开始注册硬件密钥
- `POST /api/v1/webauthn/register/finish` - 完成注册
- `POST /api/v1/webauthn/authenticate/begin` - 开始认证
- `POST /api/v1/webauthn/authenticate/finish` - 完成认证
- `GET /api/v1/webauthn/credentials` - 列出所有凭证
- `DELETE /api/v1/webauthn/credentials/:id` - 删除凭证

**数据库表：**
- `webauthn_credentials` - 存储硬件密钥凭证
- `webauthn_challenges` - 临时存储挑战（5分钟过期）

**环境变量：**
```bash
WEBAUTHN_RP_NAME=Phase           # Relying Party 名称
WEBAUTHN_RP_ID=localhost         # Relying Party ID（域名）
```

### 2. 密码泄露监控 ✅

集成 Have I Been Pwned API，使用 k-Anonymity 模型保护隐私。

**API 端点：**
- `POST /api/v1/security/check-password-breach` - 检查密码是否泄露

**请求示例：**
```json
{
  "passwordHash": "5BAA6"  // SHA-1 哈希的前5个字符
}
```

**响应示例：**
```json
{
  "breached": true,
  "count": 12345
}
```

### 3. 安全事件日志 / SIEM 集成 ✅

记录所有安全相关事件，支持多种输出方式。

**支持的事件类型：**
- 认证事件（登录成功/失败、注册、登出）
- 硬件密钥事件（注册、删除、认证）
- 密码泄露检查
- 会话管理（创建、撤销）

**环境变量配置：**
```bash
# 启用 SIEM 集成
SIEM_ENABLED=true

# 输出方式：file | syslog | http
SIEM_METHOD=file

# 文件日志路径
SIEM_FILE_PATH=/var/log/phase/security.log

# Syslog 配置
SIEM_SYSLOG_HOST=syslog.company.com
SIEM_SYSLOG_PORT=514

# HTTP API 配置
SIEM_HTTP_ENDPOINT=https://siem.company.com/api/events
SIEM_HTTP_TOKEN=your_api_token
```

**事件格式示例：**

认证成功：
```json
{
  "event_type": "authentication",
  "action": "login_success",
  "user_id": "user123",
  "ip_address": "192.168.1.100",
  "timestamp": "2026-03-09T10:30:00Z",
  "metadata": {
    "email": "user@example.com",
    "deviceName": "Chrome on Windows",
    "sessionId": "session456"
  }
}
```

硬件密钥注册：
```json
{
  "event_type": "hardware_key",
  "action": "key_registered",
  "user_id": "user123",
  "timestamp": "2026-03-09T10:35:00Z",
  "metadata": {
    "keyName": "YubiKey 5C",
    "credentialId": "abc123..."
  }
}
```

密码泄露检测：
```json
{
  "event_type": "password_check",
  "action": "breach_detected",
  "user_id": "user123",
  "timestamp": "2026-03-09T10:40:00Z",
  "metadata": {
    "breachCount": 12345
  }
}
```

## 数据库迁移

运行以下命令同步数据库：

```bash
npm run db:push
```

或者手动创建索引（MongoDB）：

```javascript
// WebAuthn 凭证索引
db.webauthn_credentials.createIndex({ userId: 1 });
db.webauthn_credentials.createIndex({ credentialId: 1 }, { unique: true });

// WebAuthn 挑战索引
db.webauthn_challenges.createIndex({ userId: 1 }, { unique: true });
db.webauthn_challenges.createIndex({ expiresAt: 1 });
```

## 安全注意事项

### WebAuthn

1. **HTTPS 必需**：WebAuthn 要求在安全上下文中运行
2. **RP ID 配置**：必须与前端域名匹配
3. **挑战过期**：挑战在 5 分钟后自动过期
4. **生产环境**：当前实现是简化版本，生产环境应使用完整的 WebAuthn 库（如 `@simplewebauthn/server`）

### 密码泄露检查

1. **隐私保护**：仅发送 SHA-1 哈希的前 5 个字符
2. **速率限制**：已集成到现有速率限制系统
3. **网络依赖**：需要访问 `api.pwnedpasswords.com`

### SIEM 集成

1. **日志轮转**：使用文件日志时，建议配置日志轮转
2. **敏感信息**：日志中不包含密码或其他敏感数据
3. **性能影响**：异步记录，不影响主请求性能

## 测试

### 测试 WebAuthn

```bash
# 1. 开始注册
curl -X POST http://localhost:3000/api/v1/webauthn/register/begin \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "X-Instance-Token: YOUR_TOKEN"

# 2. 列出凭证
curl -X GET http://localhost:3000/api/v1/webauthn/credentials \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "X-Instance-Token: YOUR_TOKEN"
```

### 测试密码泄露检查

```bash
curl -X POST http://localhost:3000/api/v1/security/check-password-breach \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "X-Instance-Token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"passwordHash":"5BAA6"}'
```

### 查看安全日志

```bash
# 控制台输出（始终启用）
npm start

# 文件日志
tail -f /var/log/phase/security.log
```

## 生产环境建议

### WebAuthn

建议使用完整的 WebAuthn 库：

```bash
npm install @simplewebauthn/server
```

然后替换 `src/utils/webauthn.ts` 中的简化实现。

### SIEM 集成

1. **文件日志**：配置 logrotate
   ```
   /var/log/phase/security.log {
       daily
       rotate 30
       compress
       delaycompress
       notifempty
       create 0640 phase phase
   }
   ```

2. **Syslog**：使用专门的 syslog 库
   ```bash
   npm install syslog-client
   ```

3. **HTTP API**：确保 SIEM 端点支持高并发

## 故障排除

### WebAuthn 不工作

- 检查 `WEBAUTHN_RP_ID` 是否与前端域名匹配
- 确保使用 HTTPS（本地开发可以用 localhost）
- 查看浏览器控制台错误

### 密码泄露检查失败

- 检查网络连接
- 确保可以访问 `api.pwnedpasswords.com`
- 查看服务器日志

### SIEM 日志未记录

- 检查 `SIEM_ENABLED=true`
- 验证文件路径权限
- 查看控制台输出（始终启用）

## 下一步

- [ ] 集成完整的 WebAuthn 库
- [ ] 添加生物识别认证后端支持
- [ ] 实现定期密码泄露扫描
- [ ] 添加更多安全事件类型
- [ ] 支持更多 SIEM 集成方式

## 参考资料

- [WebAuthn 规范](https://www.w3.org/TR/webauthn-2/)
- [Have I Been Pwned API](https://haveibeenpwned.com/API/v3)
- [SimpleWebAuthn](https://simplewebauthn.dev/)
