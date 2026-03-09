# 安全增强功能

本文档描述了Phase客户端新增的安全增强功能。

## 新增功能

### 1. 生物识别认证集成 ✅
- **状态**: 已完成（已存在于项目中）
- **位置**: `src/lib/biometric.ts`
- **功能**:
  - 使用设备生物识别（指纹、Face ID等）解锁应用
  - 支持移动端和桌面端
  - 通过Tauri插件 `@tauri-apps/plugin-biometric` 实现

### 2. 硬件密钥支持（YubiKey）✅
- **状态**: 新增完成
- **位置**:
  - `src/lib/webauthn.ts` - WebAuthn客户端库
  - `src/components/security/HardwareKeyManager.tsx` - UI组件
- **功能**:
  - 支持YubiKey、Google Titan等FIDO2硬件密钥
  - 使用WebAuthn标准
  - 支持注册、认证、管理多个硬件密钥
  - 本地存储凭证元数据

### 3. 密码泄露监控（Have I Been Pwned API）✅
- **状态**: 新增完成
- **位置**:
  - `src/components/auth/SetupPage.tsx` (line 47-70) - 注册时自动检查
  - `src/components/security/PasswordBreachMonitor.tsx` - 独立检查工具
- **功能**:
  - 使用k-Anonymity模型保护隐私（仅发送SHA-1哈希的前5个字符）
  - 注册时自动检查密码是否泄露
  - 设置页面提供独立检查工具
  - 显示密码在数据泄露中出现的次数

## 文件结构

```
src/
├── lib/
│   ├── biometric.ts              # 生物识别库（已存在）
│   └── webauthn.ts                # WebAuthn/硬件密钥库（新增）
├── components/
│   ├── auth/
│   │   └── SetupPage.tsx          # 包含HIBP检查（已更新）
│   ├── security/
│   │   ├── HardwareKeyManager.tsx # 硬件密钥管理（新增）
│   │   └── PasswordBreachMonitor.tsx # 密码泄露检查（新增）
│   └── settings/
│       └── SettingsPage.tsx       # 集成所有安全功能（已更新）
└── docs/
    └── SECURITY_API.md            # 后端API对接文档（新增）
```

## 使用方法

### 硬件密钥（YubiKey）

1. 进入设置页面
2. 找到"Security Enhancements"部分
3. 点击"Add Key"按钮
4. 插入硬件密钥并按照提示操作
5. 为密钥命名（如"YubiKey 5C"）
6. 完成注册

### 密码泄露检查

**方式1：注册时自动检查**
- 在注册新账户时，系统会自动检查密码
- 如果密码已泄露，会显示警告并阻止注册

**方式2：手动检查**
1. 进入设置页面
2. 找到"Password Breach Monitor"
3. 点击"Check Password"
4. 输入要检查的密码
5. 查看结果

### 生物识别认证

1. 进入设置页面
2. 找到"Security"部分
3. 开启"Biometric unlock"开关
4. 按照提示完成生物识别设置
5. 下次启动应用时将使用生物识别解锁

## 后端集成

### 所需API端点

硬件密钥功能需要后端实现以下API端点：

1. `POST /api/v1/webauthn/register/begin` - 开始注册
2. `POST /api/v1/webauthn/register/finish` - 完成注册
3. `POST /api/v1/webauthn/authenticate/begin` - 开始认证
4. `POST /api/v1/webauthn/authenticate/finish` - 完成认证
5. `GET /api/v1/webauthn/credentials` - 列出凭证
6. `DELETE /api/v1/webauthn/credentials/{id}` - 删除凭证

详细的API规范请参考 `docs/SECURITY_API.md`

### 数据库表

需要创建以下数据库表：

```sql
-- WebAuthn凭证表
CREATE TABLE webauthn_credentials (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    public_key BYTEA NOT NULL,
    credential_id BYTEA NOT NULL,
    aaguid BYTEA,
    sign_count INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- WebAuthn挑战表（临时存储）
CREATE TABLE webauthn_challenges (
    user_id VARCHAR(255) PRIMARY KEY,
    challenge BYTEA NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
```

## 依赖项

所有必需的依赖已在 `package.json` 中定义：

```json
{
  "dependencies": {
    "@tauri-apps/plugin-biometric": "^2.3.2",  // 生物识别
    // 其他依赖...
  }
}
```

WebAuthn功能使用浏览器原生API，无需额外依赖。

## 安装依赖

运行以下命令安装所有依赖：

```bash
pnpm install
```

或通过GitHub Actions workflow自动安装：
```bash
# 触发setup workflow
gh workflow run setup.yml
```

## 安全注意事项

1. **HTTPS必需**: WebAuthn要求在安全上下文中运行（HTTPS）
2. **隐私保护**: HIBP检查使用k-Anonymity，不会泄露完整密码
3. **本地存储**: 硬件密钥凭证元数据存储在localStorage
4. **多因素认证**: 建议用户注册多个硬件密钥作为备份
5. **挑战过期**: WebAuthn挑战应在5分钟后过期

## 浏览器兼容性

### WebAuthn支持
- ✅ Chrome/Edge 67+
- ✅ Firefox 60+
- ✅ Safari 13+
- ✅ Opera 54+

### 生物识别支持
- ✅ Windows Hello (Windows 10+)
- ✅ Touch ID (macOS)
- ✅ Face ID (iOS)
- ✅ 指纹识别 (Android)

## 测试

### 硬件密钥测试
1. 使用真实的YubiKey或其他FIDO2设备
2. 测试注册流程
3. 测试认证流程
4. 测试删除凭证

### 密码泄露检查测试
使用已知泄露的密码测试（如"password123"）应该显示警告。

## 故障排除

### WebAuthn不工作
- 确保使用HTTPS
- 检查浏览器是否支持WebAuthn
- 确保硬件密钥已插入并解锁

### 生物识别不工作
- 确保设备支持生物识别
- 检查操作系统设置
- 确保Tauri插件正确安装

### HIBP检查失败
- 检查网络连接
- 确保可以访问 `api.pwnedpasswords.com`
- 检查浏览器控制台错误

## 未来改进

- [ ] 支持Passkeys（无密码登录）
- [ ] 支持条件UI（自动填充）
- [ ] 添加硬件密钥使用统计
- [ ] 定期密码泄露扫描
- [ ] 支持更多生物识别方式

## 参考资料

- [WebAuthn规范](https://www.w3.org/TR/webauthn-2/)
- [FIDO Alliance](https://fidoalliance.org/)
- [Have I Been Pwned API](https://haveibeenpwned.com/API/v3)
- [Yubico开发者文档](https://developers.yubico.com/)
- [Tauri生物识别插件](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/biometric)
