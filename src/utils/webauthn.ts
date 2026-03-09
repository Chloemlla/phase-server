import crypto from "node:crypto";

// WebAuthn 相关的工具函数

export interface PublicKeyCredentialCreationOptions {
  challenge: string;
  rp: {
    name: string;
    id: string;
  };
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  pubKeyCredParams: Array<{
    type: "public-key";
    alg: number;
  }>;
  timeout: number;
  attestation: "none" | "direct" | "indirect";
  authenticatorSelection: {
    authenticatorAttachment?: "platform" | "cross-platform";
    requireResidentKey: boolean;
    userVerification: "required" | "preferred" | "discouraged";
  };
}

export interface PublicKeyCredentialRequestOptions {
  challenge: string;
  timeout: number;
  rpId: string;
  allowCredentials: Array<{
    type: "public-key";
    id: string;
  }>;
  userVerification: "required" | "preferred" | "discouraged";
}

/**
 * 生成随机挑战（32字节）
 */
export function generateChallenge(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * 创建注册选项
 */
export function createRegistrationOptions(
  userId: string,
  userEmail: string,
  rpName: string,
  rpId: string,
): PublicKeyCredentialCreationOptions {
  const challenge = generateChallenge();

  return {
    challenge,
    rp: {
      name: rpName,
      id: rpId,
    },
    user: {
      id: Buffer.from(userId).toString("base64url"),
      name: userEmail,
      displayName: userEmail,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },  // ES256
      { type: "public-key", alg: -257 }, // RS256
    ],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: {
      authenticatorAttachment: "cross-platform",
      requireResidentKey: false,
      userVerification: "preferred",
    },
  };
}

/**
 * 创建认证选项
 */
export function createAuthenticationOptions(
  rpId: string,
  credentialIds: string[],
): PublicKeyCredentialRequestOptions {
  const challenge = generateChallenge();

  return {
    challenge,
    timeout: 60000,
    rpId,
    allowCredentials: credentialIds.map((id) => ({
      type: "public-key",
      id,
    })),
    userVerification: "preferred",
  };
}

/**
 * 验证注册响应
 * 简化版本 - 生产环境应使用完整的 WebAuthn 库
 */
export function verifyRegistrationResponse(
  challenge: string,
  _credentialId: string,
  _attestationObject: string,
  clientDataJSON: string,
): boolean {
  try {
    // 解码 clientDataJSON
    const clientData = JSON.parse(
      Buffer.from(clientDataJSON, "base64url").toString("utf-8"),
    );

    // 验证类型
    if (clientData.type !== "webauthn.create") {
      return false;
    }

    // 验证挑战
    if (clientData.challenge !== challenge) {
      return false;
    }

    // 简化验证 - 生产环境需要完整验证 attestation
    return true;
  } catch {
    return false;
  }
}

/**
 * 验证认证响应
 * 简化版本 - 生产环境应使用完整的 WebAuthn 库
 */
export function verifyAuthenticationResponse(
  challenge: string,
  _credentialId: string,
  _authenticatorData: string,
  clientDataJSON: string,
  _signature: string,
  _publicKey: string,
): boolean {
  try {
    // 解码 clientDataJSON
    const clientData = JSON.parse(
      Buffer.from(clientDataJSON, "base64url").toString("utf-8"),
    );

    // 验证类型
    if (clientData.type !== "webauthn.get") {
      return false;
    }

    // 验证挑战
    if (clientData.challenge !== challenge) {
      return false;
    }

    // 简化验证 - 生产环境需要验证签名
    // 这里应该使用公钥验证签名，但需要完整的 WebAuthn 库
    return true;
  } catch {
    return false;
  }
}
