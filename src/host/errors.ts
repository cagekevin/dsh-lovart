/**
 * 全插件唯一错误模型（ADR-0009 第一级：写不出来）。
 * 构造函数私有：外部无法 new，只能走静态工厂；对外只有一个 respond() 出口。
 * 新增错误码不补 statusOf 的 switch，assertNever 会直接编译不过。
 */

/** 错误分类；路由按 code 映射 HTTP 状态，工具/job 只读 message。 */
export type LovartErrorCode =
  | 'INVALID_INPUT'
  | 'CREDENTIALS_MISSING'
  | 'UPSTREAM'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'CWD_UNKNOWN'
  | 'INTERNAL'

/** 路由唯一响应形状；错误永远只有一条 string，不带堆栈。 */
export interface ErrorResponse {
  status: number
  body: { error: string }
}

/** 唯一可抛错误；upstreamCode 保留上游业务码，便于日志与文案拼接。 */
export class LovartError extends Error {
  readonly code: LovartErrorCode
  readonly upstreamCode: number | undefined

  private constructor(
    code: LovartErrorCode,
    message: string,
    options: { upstreamCode?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'LovartError'
    this.code = code
    this.upstreamCode = options.upstreamCode
  }

  static invalidInput(message: string): LovartError {
    return new LovartError('INVALID_INPUT', message)
  }

  static credentialsMissing(message: string): LovartError {
    return new LovartError('CREDENTIALS_MISSING', message)
  }

  static upstream(message: string, upstreamCode?: number, cause?: unknown): LovartError {
    return new LovartError('UPSTREAM', message, { upstreamCode, cause })
  }

  static conflict(message: string): LovartError {
    return new LovartError('CONFLICT', message)
  }

  static notFound(message: string): LovartError {
    return new LovartError('NOT_FOUND', message)
  }

  static cwdUnknown(message: string): LovartError {
    return new LovartError('CWD_UNKNOWN', message)
  }

  static internal(message: string, cause?: unknown): LovartError {
    return new LovartError('INTERNAL', message, { cause })
  }
}

/** 唯一对外出口：任意异常进、路由响应出；未知异常不泄漏细节。 */
export function respond(error: unknown): ErrorResponse {
  if (!(error instanceof LovartError)) {
    return { status: 500, body: { error: '内部错误' } }
  }
  return { status: statusOf(error.code), body: { error: error.message } }
}

function statusOf(code: LovartErrorCode): number {
  switch (code) {
    case 'INVALID_INPUT':
      return 400
    case 'CREDENTIALS_MISSING':
      return 409
    case 'UPSTREAM':
      return 502
    case 'CONFLICT':
      return 409
    case 'NOT_FOUND':
      return 404
    case 'CWD_UNKNOWN':
      return 500
    case 'INTERNAL':
      return 500
    default:
      return assertNever(code)
  }
}

/** 穷尽分支：新增错误码或判别联合成员不补 case，调用处编译不过。 */
export function assertNever(value: never): never {
  throw LovartError.internal(`未覆盖的分支：${String(value)}`)
}
