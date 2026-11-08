const MESSAGES = Object.freeze({
  CREDENTIAL_DECRYPT_FAILED: '无法读取本机加密凭证：需要系统密钥存储授权，或该凭证无法解密。macOS 钥匙串通常使用 Mac 登录密码。请先完成系统授权；授权后仍失败，再到“模型与设置 → 凭证”替换 API Key。本次生成请求未发送。',
  CREDENTIAL_STORE_UNREADABLE: '无法读取本机凭证库，原文件已保留。请检查本机存储与凭证库状态后重试。本次生成请求未发送。',
  CREDENTIAL_NOT_FOUND: '所选凭证不存在、已停用或不属于当前连接。请到“模型与设置 → 凭证”选择当前连接的可用 API Key。本次生成请求未发送。',
  CREDENTIAL_INVALID: '凭证配置无效，请重新选择当前连接的可用 API Key。本次生成请求未发送。',
});

function credentialErrorMessage(code) {
  return typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined;
}

// Never retain native Keychain errors, ciphertext or API keys in public failures.
class CredentialStoreError extends Error {
  constructor(code) {
    const safeCode = credentialErrorMessage(code) ? code : 'CREDENTIAL_INVALID';
    super(credentialErrorMessage(safeCode));
    this.name = 'CredentialStoreError';
    Object.defineProperty(this, 'code', { value: safeCode, enumerable: true });
  }
}

module.exports = { CredentialStoreError, credentialErrorMessage };
