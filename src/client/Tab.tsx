/**
 * 侧栏 tab：图墙 + 提交框 + 确认按钮 + 灯箱。
 *
 * 数据只来自 `/lovart/api`（client/api.ts）；`phase` 直接展示后端字段，前端不推导、不计算。
 * 前端只做一件事能改变状态的动作：确认。其余（取消、查输出）交给 DSH 自带 job 面板。
 * 样式全部走 styles.ts 的 class，禁止内联 style。
 */

import {
  useEffect,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type ReactElement,
} from 'react'
import {
  cancelJob,
  confirmJob,
  createJobs,
  deleteJob,
  listJobs,
  loadHealth,
  loadOptions,
  saveCredentials,
  uploadRef,
  type Health,
  type JobMeta,
  type Options,
  type PhaseTone,
} from './api.ts'
import { mediaUrl, type MediaScope } from './media.ts'
import { ensureStyles } from './styles.ts'

/** 侧栏 props 里本 tab 用到的部分；其余字段不读。 */
export interface TabProps {
  readonly ctx: { get(name: string): unknown }
  readonly scope: MediaScope
}

const POLL_MS = 2000

/** 出图三件套；只在 options 到达后才有值，默认值来自后端。 */
interface Choice {
  readonly model: string
  readonly ratio: string
  readonly size: string
}

/** 已上传的参考图；url 是上游 CDN 地址，直接用于提交。 */
interface RefItem {
  readonly name: string
  readonly url: string
}

/** 侧栏 tab 图标；纯 SVG，不带内联样式。 */
export function LovartIcon(): ReactElement {
  return (
    <svg className="lovart-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5v-7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <path
        d="M3 11l3.2-3.4 2.1 2.1L11 6.8 13 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

/** 侧栏唯一 tab 组件。 */
export function LovartTab(props: TabProps): ReactElement {
  ensureStyles()
  const [jobs, setJobs] = useState<readonly JobMeta[]>([])
  // 两个错误源分开：轮询成功只清自己造成的错误，不吞掉提交/确认的提示（那会 2s 内消失）。
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [listError, setListError] = useState<string | undefined>(undefined)
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [refs, setRefs] = useState<readonly RefItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [options, setOptions] = useState<Options | undefined>(undefined)
  const [choice, setChoice] = useState<Choice | undefined>(undefined)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | undefined>(undefined)
  const [pendingConfirm, setPendingConfirm] = useState<readonly string[]>([])
  const [health, setHealth] = useState<Health | undefined>(undefined)
  const [keys, setKeys] = useState({ accessKey: '', secretKey: '' })
  const [savingKeys, setSavingKeys] = useState(false)
  /** 凭据面板：未配置时自动展开；已配置时靠顶部「凭据」按钮手动打开。 */
  const [credsOpen, setCredsOpen] = useState(false)
  /** 删除要两步：第一次点只把按钮变成「确认删除」。 */
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>(undefined)
  /** 确认请求失败的任务：按钮换成「取消此任务」，否则会卡在 confirming 无处可去。 */
  const [confirmFailed, setConfirmFailed] = useState<readonly string[]>([])
  const [copied, setCopied] = useState<string | undefined>(undefined)
  const [menu, setMenu] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  // 「已复制」只亮 1.5s；定时器随状态清理，避免卸载后 setState。
  useEffect(() => {
    if (copied === undefined) return
    const timer = setTimeout(() => setCopied(undefined), 1_500)
    return () => clearTimeout(timer)
  }, [copied])

  // 提示条同理，只亮 1.5s。
  useEffect(() => {
    if (notice === undefined) return
    const timer = setTimeout(() => setNotice(undefined), 1_500)
    return () => clearTimeout(timer)
  }, [notice])

  // 菜单点外面就收；不在每个卡片上各挂一份监听。
  useEffect(() => {
    if (menu === undefined) return
    const close = (): void => setMenu(undefined)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menu])

  // 灯箱打开时才挂键盘监听：常驻全局 keydown 会在别的 tab 里也吃掉 Esc。
  useEffect(() => {
    if (lightbox === undefined) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setLightbox(undefined)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [lightbox])

  // 选项只拉一次；下拉全部来自后端，前端不写第二份模型/比例/尺寸表。
  useEffect(() => {
    let active = true
    void loadOptions()
      .then((next) => {
        if (!active) return
        setOptions(next)
        setChoice({
          model: next.defaults.model,
          ratio: next.defaults.ratio,
          size: next.defaults.size,
        })
      })
      .catch((cause: unknown) => {
        if (active) setActionError(messageOf(cause))
      })
    return () => {
      active = false
    }
  }, [])

  // 凭据状态只决定「显不显示输入框」；读不到就按已配置处理，提交时后端会报准确错误。
  useEffect(() => {
    let active = true
    void loadHealth()
      .then((next) => {
        if (active) setHealth(next)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // 2s 轮询图墙；卸载后不再 setState，避免过期的定时器写回旧组件。
  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      try {
        const next = await listJobs(props.scope.sessionId)
        if (!active) return
        setJobs(next)
        setListError(undefined)
      } catch (cause) {
        if (active) setListError(messageOf(cause))
      }
    }
    void load()
    const timer = setInterval(() => {
      void load()
    }, POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const text = prompt.trim()
    if (text === '' || busy || uploading || choice === undefined) return
    setBusy(true)
    try {
      await createJobs({
        sessionId: props.scope.sessionId,
        prompt: text,
        model: choice.model,
        ratio: choice.ratio,
        size: choice.size,
        count,
        refs: refs.map((ref) => ref.url),
      })
      setPrompt('')
      setRefs([])
      setActionError(undefined)
    } catch (cause) {
      const message = messageOf(cause)
      setActionError(message)
      // 凭据类错误直接把输入框摆出来，否则用户不知道要去哪儿改。
      if (message.includes('凭据')) setCredsOpen(true)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 选图与粘贴共用这一条上传路径：逐张上传，任何一张失败就整批不加入，
   * 避免静默降级成文生图。两条入口一个出口，别各写一份。
   */
  const addRefFiles = async (files: readonly File[]): Promise<void> => {
    if (files.length === 0 || options === undefined || uploading) return
    const room = options.maxRefs - refs.length
    if (room <= 0) {
      setActionError(`参考图最多 ${options.maxRefs} 张`)
      return
    }
    const picked = files.slice(0, room)
    setUploading(true)
    try {
      const dataUrls = await Promise.all(picked.map(readDataUrl))
      const urls = await Promise.all(
        dataUrls.map((dataUrl, index) =>
          uploadRef({ name: refName(picked[index], index), dataUrl }),
        ),
      )
      setRefs((previous) => [
        ...previous,
        ...urls.map((url, index) => ({ name: refName(picked[index], index), url })),
      ])
      setActionError(
        picked.length < files.length
          ? `参考图最多 ${options.maxRefs} 张，已忽略 ${files.length - picked.length} 张`
          : undefined,
      )
    } catch (cause) {
      setActionError(messageOf(cause))
    } finally {
      setUploading(false)
    }
  }

  const pickRefs = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files ?? [])
    // 清空 value，允许再次选择同一个文件。
    event.target.value = ''
    await addRefFiles(files)
  }

  /** 粘贴图片：只截 clipboard 里的 image/*，文本照常落进输入框。 */
  const pasteRefs = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    // 有图就吃掉这次粘贴，否则浏览器会再往输入框里塞一串文件名。
    event.preventDefault()
    void addRefFiles(files)
  }

  const removeRef = (url: string): void => {
    setRefs((previous) => previous.filter((ref) => ref.url !== url))
  }

  /** 三个下拉共用一次状态更新；options 未到时不可选。 */
  const choose = (patch: Partial<Choice>): void => {
    setChoice((previous) => (previous === undefined ? previous : { ...previous, ...patch }))
  }

  /** 确认会扣积分：先本地置灰，慢网或双击都只会有一次 POST；失败才恢复可点。 */
  const confirm = async (jobId: string): Promise<void> => {
    setPendingConfirm((previous) =>
      previous.includes(jobId) ? previous : [...previous, jobId],
    )
    try {
      await confirmJob(jobId, props.scope.sessionId)
      setActionError(undefined)
      setConfirmFailed((previous) => previous.filter((id) => id !== jobId))
    } catch (cause) {
      setActionError(messageOf(cause))
      setPendingConfirm((previous) => previous.filter((id) => id !== jobId))
      // confirmCount 已经置 1，再点只会 409；把按钮换成取消，别让人卡死。
      setConfirmFailed((previous) =>
        previous.includes(jobId) ? previous : [...previous, jobId],
      )
    }
  }

  /**
   * 取消 = 放弃这个任务，图也不要了。
   *
   * 文案与 title 必须说清「上游可能仍在跑」——C1 没有中止端点，取消只让本地
   * 不再等、不再下载、清掉已落盘的部分。
   */
  const cancel = async (job: JobMeta): Promise<void> => {
    setMenu(undefined)
    try {
      await cancelJob(job.jobId, props.scope.sessionId)
      setActionError(undefined)
    } catch (cause) {
      setActionError(messageOf(cause))
    }
  }

  /** 重跑：不新增接口，把历史任务参数原样再 POST /jobs 一次。 */
  const rerun = async (job: JobMeta): Promise<void> => {
    setActionError(undefined)
    try {
      await createJobs({
        sessionId: props.scope.sessionId,
        prompt: job.prompt,
        model: job.model === '' ? undefined : job.model,
        ratio: job.ratio === '' ? undefined : job.ratio,
        size: job.size === '' ? undefined : job.size,
        count: 1,
        refs: job.refs,
      })
    } catch (cause) {
      setActionError(messageOf(cause))
    }
  }

  /** 存进 DSH 凭据库；存完重读一次状态，输入框随即收起。 */
  const saveKeys = async (): Promise<void> => {
    setSavingKeys(true)
    try {
      await saveCredentials({
        accessKey: keys.accessKey.trim(),
        secretKey: keys.secretKey.trim(),
      })
      setKeys({ accessKey: '', secretKey: '' })
      setHealth(await loadHealth())
      // 存完就收起面板，否则输入框空着还占一块地方。
      setCredsOpen(false)
      setActionError(undefined)
    } catch (cause) {
      setActionError(messageOf(cause))
    } finally {
      setSavingKeys(false)
    }
  }

  /** 复制图片到剪贴板：统一转 PNG，webp/jpeg 在部分浏览器会被剪贴板拒绝。 */
  const copyImage = async (src: string, file: string): Promise<void> => {
    try {
      const response = await fetch(src)
      if (!response.ok) throw new Error('读取图片失败')
      const png = await toPng(await response.blob())
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      setCopied(file)
      setActionError(undefined)
    } catch (cause) {
      setActionError(
        cause instanceof Error && cause.name === 'NotAllowedError'
          ? '浏览器拒绝了剪贴板写入'
          : messageOf(cause),
      )
    }
  }

  /** 复制提示词：只写文本，不走图片那条转码路径。 */
  const copyPrompt = async (job: JobMeta): Promise<void> => {
    setMenu(undefined)
    try {
      await navigator.clipboard.writeText(job.prompt)
      setNotice('已复制提示词')
    } catch (cause) {
      setActionError(messageOf(cause))
    }
  }

  /**
   * 删任务：两步，第一次点只把按钮变成「确认删除」。
   *
   * 删了不可恢复，图也会一起删掉；没有这一步，误点一次就没了。
   */
  const removeJob = async (job: JobMeta): Promise<void> => {
    if (confirmDelete !== job.jobId) {
      // 第一次点只换文案，**菜单留着**：关掉再打开会重置确认态，永远确认不了。
      setConfirmDelete(job.jobId)
      return
    }
    setMenu(undefined)
    setConfirmDelete(undefined)
    try {
      await deleteJob(job.jobId, props.scope.sessionId)
      setJobs((previous) => previous.filter((item) => item.jobId !== job.jobId))
      setActionError(undefined)
    } catch (cause) {
      setActionError(messageOf(cause))
    }
  }

  const error = actionError ?? listError
  const missingCredentials = health !== undefined && !health.credentials
  // 未配置时强制展开；已配置时由顶部按钮手动开关（key 填错要能回去改）。
  const credsVisible = credsOpen || missingCredentials

  return (
    <div className="lovart-root">
      <div className="lovart-top">
        <span className="lovart-top-title">Lovart 作图</span>
        <button
          className="lovart-ghost"
          type="button"
          aria-expanded={credsVisible}
          onClick={() => setCredsOpen((previous) => !previous)}
        >
          凭据
        </button>
      </div>

      {credsVisible && (
        <section className="lovart-creds">
          <p className="lovart-creds-title">
            {missingCredentials ? '未配置 Lovart 凭据' : 'Lovart 凭据'}
          </p>
          <label className="lovart-field">
            <span className="lovart-field-label">Access Key</span>
            <input
              className="lovart-input"
              type="password"
              autoComplete="off"
              value={keys.accessKey}
              onChange={(event) =>
                setKeys((previous) => ({ ...previous, accessKey: event.target.value }))
              }
            />
          </label>
          <label className="lovart-field">
            <span className="lovart-field-label">Secret Key</span>
            <input
              className="lovart-input"
              type="password"
              autoComplete="off"
              value={keys.secretKey}
              onChange={(event) =>
                setKeys((previous) => ({ ...previous, secretKey: event.target.value }))
              }
            />
          </label>
          <div className="lovart-form-row lovart-form-row-end">
            <button
              className="lovart-primary"
              type="button"
              disabled={
                savingKeys ||
                health?.credentialsWritable === false ||
                keys.accessKey.trim() === '' ||
                keys.secretKey.trim() === ''
              }
              onClick={() => void saveKeys()}
            >
              {savingKeys ? '保存中…' : '保存凭据'}
            </button>
          </div>
          <p className="lovart-ref-hint">
            {health?.credentialsWritable === false
              ? '当前凭据源不可写，请改用环境变量 LOVART_ACCESS_KEY / LOVART_SECRET_KEY。'
              : '保存进 DSH 凭据库（LOVART_ACCESS_KEY / LOVART_SECRET_KEY）；插件不落盘、不缓存。'}
          </p>
        </section>
      )}

      <form className="lovart-form" onSubmit={(event) => void submit(event)}>
        <div className="lovart-refs">
          {refs.map((ref, index) => (
            <div className="lovart-ref" key={`${ref.url}-${index}`}>
              <img className="lovart-ref-img" src={ref.url} alt={ref.name} />
              <button
                className="lovart-ref-remove"
                type="button"
                aria-label={`移除参考图 ${ref.name}`}
                onClick={() => removeRef(ref.url)}
              >
                ✕
              </button>
            </div>
          ))}
          <label className="lovart-ref-add">
            {uploading ? '上传中…' : '＋ 参考图'}
            <input
              className="lovart-ref-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              disabled={uploading}
              onChange={(event) => void pickRefs(event)}
            />
          </label>
        </div>
        <p className="lovart-ref-hint">本地图片，可多选，也可直接粘贴；提交时上传到 Lovart CDN</p>
        <textarea
          className="lovart-prompt"
          value={prompt}
          rows={3}
          placeholder="描述要画的图…（可直接粘贴图片）"
          onChange={(event) => setPrompt(event.target.value)}
          onPaste={pasteRefs}
        />
        <div className="lovart-params">
          <label className="lovart-field">
            <span className="lovart-field-label">模型</span>
            <select
              className="lovart-select"
              value={choice?.model ?? ''}
              disabled={options === undefined}
              onChange={(event) => choose({ model: event.target.value })}
            >
              {(options?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
          <div className="lovart-param-row">
            <label className="lovart-field">
              <span className="lovart-field-label">比例</span>
              <select
                className="lovart-select"
                value={choice?.ratio ?? ''}
                disabled={options === undefined}
                onChange={(event) => choose({ ratio: event.target.value })}
              >
                {(options?.ratios ?? []).map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ratio}
                  </option>
                ))}
              </select>
            </label>
            <label className="lovart-field">
              <span className="lovart-field-label">尺寸</span>
              <select
                className="lovart-select"
                value={choice?.size ?? ''}
                disabled={options === undefined}
                onChange={(event) => choose({ size: event.target.value })}
              >
                {(options?.sizes ?? []).map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <label className="lovart-field">
              <span className="lovart-field-label">张数</span>
              <select
                className="lovart-select"
                value={count}
                disabled={options === undefined}
                onChange={(event) => setCount(Number(event.target.value))}
              >
                {Array.from({ length: options?.maxCount ?? 1 }, (_item, index) => index + 1).map(
                  (value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
        </div>
        <div className="lovart-form-row lovart-form-row-end">
          <button
            className="lovart-primary"
            type="submit"
            disabled={
              busy ||
              uploading ||
              missingCredentials ||
              choice === undefined ||
              prompt.trim() === ''
            }
          >
            {busy ? '提交中…' : '开始生成'}
          </button>
        </div>
      </form>

      {error !== undefined && <p className="lovart-error">{error}</p>}
      {notice !== undefined && <p className="lovart-notice">{notice}</p>}

      {jobs.length === 0 ? (
        <p className="lovart-empty">
          本会话还没有任务。免费排队可能要等一会儿；历史图在会话工作目录的 lovart/ 里。
        </p>
      ) : (
        <ul className="lovart-list">
          {jobs.map((job) => {
            // 徽章外观由 host 派生（tone），前端不再按 phase 判断（ADR-0005）。
            const tone = job.tone
            const pinned = tone === 'waiting'
            const waiting = pendingConfirm.includes(job.jobId)
            return (
              <li className={pinned ? 'lovart-job is-pinned' : 'lovart-job'} key={job.jobId}>
                <div className="lovart-job-head">
                  <div className="lovart-job-tags">
                    {pinned && <span className="lovart-pin">置顶</span>}
                    <span className="lovart-seq">#{job.seq}</span>
                    <span className={phaseClassOf(tone)}>
                      {tone === 'active' && <span className="lovart-dot" />}
                      <span>{job.phaseLabel}</span>
                    </span>
                    <span className="lovart-elapsed">{elapsedText(job)}</span>
                  </div>
                  <div className="lovart-job-tools">
                    <span className="lovart-model">
                      {job.model} · {job.ratio} · {job.size}
                    </span>
                    <div className="lovart-more-wrap">
                      <button
                        className="lovart-more"
                        type="button"
                        aria-label="更多操作"
                        aria-expanded={menu === job.jobId}
                        onClick={(event) => {
                          // 不加这行，document 的关闭监听会立刻把它关掉。
                          event.stopPropagation()
                          const opening = menu !== job.jobId
                          // 换一张卡才重置确认态；同一张卡重开时保留，否则两步删除走不完。
                          if (opening) setConfirmDelete(undefined)
                          setMenu(opening ? job.jobId : undefined)
                        }}
                      >
                        ⋮
                      </button>
                      {menu === job.jobId && (
                        <div
                          className="lovart-menu"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            className="lovart-menu-item"
                            type="button"
                            onClick={() => void copyPrompt(job)}
                          >
                            复制提示词
                          </button>
                          {!job.terminal && (
                            <button
                              className="lovart-menu-item"
                              type="button"
                              title="放弃此任务，已生成的部分会删掉；上游可能仍在跑"
                              onClick={() => void cancel(job)}
                            >
                              取消任务
                            </button>
                          )}
                          {job.terminal && (
                            <button
                              className="lovart-menu-item lovart-menu-danger"
                              type="button"
                              title="同时删除 lovart/ 里的图片文件，不可恢复"
                              onClick={() => void removeJob(job)}
                            >
                              {confirmDelete === job.jobId ? '确认删除？' : '删除此任务'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <p className="lovart-prompt-text">{job.prompt}</p>
                {job.refs.length > 0 && (
                  <div className="lovart-job-refs">
                    {job.refs.map((ref) => (
                      <div className="lovart-job-ref" key={ref} title={`垫图：${ref}`}>
                        <img className="lovart-job-ref-img" src={ref} alt="参考图" />
                      </div>
                    ))}
                  </div>
                )}
                {pinned && (
                  <>
                    <p className="lovart-job-note">
                      {confirmFailed.includes(job.jobId)
                        ? '确认没有成功；confirmCount 已置 1，再点只会报错，只能取消这个任务。'
                        : '需你确认后才会继续；这一步会消耗积分'}
                    </p>
                    {confirmFailed.includes(job.jobId) ? (
                      <button
                        className="lovart-ghost lovart-confirm"
                        type="button"
                        onClick={() => void cancel(job)}
                      >
                        取消此任务
                      </button>
                    ) : (
                      <button
                        className="lovart-primary lovart-confirm"
                        type="button"
                        disabled={waiting}
                        onClick={() => void confirm(job.jobId)}
                      >
                        {waiting ? '已确认，等待上游继续…' : '确认并继续（会扣积分）'}
                      </button>
                    )}
                  </>
                )}
                {job.error !== undefined && <p className="lovart-job-error">{job.error}</p>}
                {job.files.length > 0 && (
                  <>
                    <div className="lovart-grid">
                      {job.files.map((file) => {
                        const src = mediaUrl(props.ctx, props.scope, file)
                        return (
                          <div className="lovart-thumb-cell" key={file}>
                            <button
                              className="lovart-thumb"
                              type="button"
                              onClick={() => setLightbox({ src, alt: job.prompt })}
                            >
                              <img className="lovart-thumb-img" src={src} alt={job.prompt} />
                            </button>
                            <button
                              className="lovart-copy"
                              type="button"
                              aria-label="复制图片"
                              title="复制图片到剪贴板"
                              onClick={() => void copyImage(src, file)}
                            >
                              {copied === file ? '已复制' : '复制'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    <p className="lovart-meta">{job.files.length} 张 · 已保存到 lovart/</p>
                  </>
                )}
                {job.terminal && (
                  <div className="lovart-job-actions">
                    <button
                      className="lovart-ghost"
                      type="button"
                      title="用同一提示词与参数再生成一次（会重新排队、重新花额度）"
                      onClick={() => void rerun(job)}
                    >
                      重跑
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {lightbox !== undefined && (
        <div className="lovart-lightbox" role="dialog" onClick={() => setLightbox(undefined)}>
          <img className="lovart-lightbox-img" src={lightbox.src} alt={lightbox.alt} />
          <button
            className="lovart-lightbox-close"
            type="button"
            aria-label="关闭"
            onClick={() => setLightbox(undefined)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : '请求失败'
}

/** 只有 waiting / done 有专属样式；active 与 idle 共用基础胶囊。 */
function phaseClassOf(tone: PhaseTone): string {
  if (tone === 'waiting') return 'lovart-phase is-waiting'
  if (tone === 'done') return 'lovart-phase is-done'
  return 'lovart-phase'
}

/** 终态用 host 的 settledAt 算耗时；在跑的任务用本地时钟减 host 的 createdAt。 */
function elapsedText(job: JobMeta): string {
  const end = job.terminal && job.settledAt !== undefined ? job.settledAt : Date.now()
  const seconds = Math.max(0, Math.round((end - job.createdAt) / 1000))
  return job.terminal ? `耗时 ${formatDuration(seconds)}` : `已跑 ${formatDuration(seconds)}`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
}

/** 任意位图 → PNG；canvas 只在这一处用，剪贴板只收这一种格式最稳。 */
async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('无法创建画布')
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result === null) reject(new Error('图片转换失败'))
        else resolve(result)
      }, 'image/png')
    })
  } finally {
    bitmap.close()
  }
}

/** 剪贴板里的图常常没有文件名；给一个带扩展名的兜底，上游按 filename 存。 */
function refName(file: File | undefined, index: number): string {
  if (file === undefined) return `pasted-${index + 1}.png`
  if (file.name !== '') return file.name
  const ext = file.type.split('/')[1] ?? 'png'
  return `pasted-${index + 1}.${ext}`
}

/** 浏览器选图只能读成 data URL；host 再从 data URL 解出字节转发上游。 */
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('无法读取参考图'))
    }
    reader.onerror = () => reject(new Error('无法读取参考图'))
    reader.readAsDataURL(file)
  })
}
