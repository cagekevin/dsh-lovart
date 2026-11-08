/**
 * 侧栏样式：运行时注入一个 `<style>`，只注入一次。
 *
 * 全部走 class，组件里禁止内联 style —— 换肤、覆盖、审查都只在这一个文件里发生。
 * 配色：白底 + 高级灰，不用紫色。
 */

const STYLE_ID = 'dsh-lovart-style'

const CSS = `
.lovart-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: #ffffff;
  color: #1f2328;
  font-size: 13px;
  line-height: 1.5;
}
.lovart-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lovart-prompt {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 64px;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafafa;
  color: #1f2328;
  font: inherit;
}
.lovart-prompt:focus {
  outline: none;
  border-color: #9ca3af;
  background: #ffffff;
}
.lovart-form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.lovart-form-row-end {
  justify-content: flex-end;
}
.lovart-creds {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafafa;
}
.lovart-creds-title {
  margin: 0;
  color: #111827;
  font-weight: 600;
}
.lovart-input {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2328;
  font: inherit;
}
.lovart-input:focus {
  outline: none;
  border-color: #9ca3af;
}
.lovart-refs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.lovart-ref-hint {
  margin: 0;
  color: #9ca3af;
  font-size: 11px;
}
.lovart-ref {
  position: relative;
  width: 56px;
  height: 56px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f3f4f6;
  overflow: hidden;
}
.lovart-ref-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lovart-ref-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.72);
  color: #ffffff;
  font-size: 10px;
  line-height: 16px;
  cursor: pointer;
}
.lovart-ref-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border: 1px dashed #d1d5db;
  border-radius: 8px;
  color: #6b7280;
  font-size: 11px;
  text-align: center;
  cursor: pointer;
}
.lovart-ref-add:hover {
  border-color: #9ca3af;
  color: #374151;
}
.lovart-ref-input {
  display: none;
}
.lovart-params {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lovart-param-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.lovart-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  color: #6b7280;
  font-size: 11px;
}
.lovart-field-label {
  color: #6b7280;
  font-size: 11px;
}
.lovart-select {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  color: #1f2328;
  font: inherit;
}
.lovart-select:disabled {
  color: #9ca3af;
  background: #fafafa;
}
.lovart-primary {
  padding: 6px 12px;
  border: 1px solid #111827;
  border-radius: 6px;
  background: #111827;
  color: #ffffff;
  font: inherit;
  cursor: pointer;
}
.lovart-primary:hover:not(:disabled) {
  background: #374151;
}
.lovart-primary:disabled {
  border-color: #d1d5db;
  background: #d1d5db;
  cursor: default;
}
.lovart-error {
  margin: 0;
  padding: 6px 8px;
  border: 1px solid #fecaca;
  border-radius: 6px;
  background: #fef2f2;
  color: #b91c1c;
}
.lovart-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.lovart-top-title {
  color: #111827;
  font-weight: 600;
}
.lovart-seq {
  color: #9ca3af;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
/* 键盘用户必须看得见焦点：与 .lovart-prompt:focus 同一套描边。 */
.lovart-ghost:focus-visible,
.lovart-more:focus-visible,
.lovart-menu-item:focus-visible,
.lovart-copy:focus-visible {
  outline: 2px solid #9ca3af;
  outline-offset: 1px;
}
.lovart-empty {
  margin: 0;
  color: #6b7280;
}
.lovart-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.lovart-job {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #ffffff;
}
.lovart-job.is-pinned {
  border-color: #111827;
  background: #fbfbfb;
  box-shadow: inset 3px 0 0 #111827;
}
.lovart-job-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.lovart-pin {
  padding: 1px 6px;
  border: 1px dashed #9ca3af;
  border-radius: 999px;
  color: #6b7280;
  font-size: 10px;
  letter-spacing: 0.04em;
}
.lovart-job-note {
  margin: 0;
  color: #6b7280;
  font-size: 11px;
}
.lovart-meta {
  margin: 0;
  color: #9ca3af;
  font-size: 11px;
}
.lovart-job-refs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.lovart-job-ref {
  width: 26px;
  height: 26px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
}
.lovart-job-ref-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lovart-job-error {
  margin: 0;
  color: #b91c1c;
  font-size: 12px;
}
.lovart-job-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lovart-elapsed {
  color: #9ca3af;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.lovart-ghost {
  padding: 2px 8px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  color: #374151;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.lovart-ghost:hover {
  border-color: #9ca3af;
  color: #111827;
}
.lovart-job-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.lovart-phase {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #374151;
  font-size: 11px;
  letter-spacing: 0.02em;
}
.lovart-phase.is-waiting {
  background: #111827;
  color: #ffffff;
}
.lovart-phase.is-done {
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  color: #6b7280;
}
.lovart-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #6b7280;
  animation: lovart-pulse 1.2s ease-in-out infinite;
}
@keyframes lovart-pulse {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lovart-dot {
    animation: none;
  }
}
.lovart-model {
  color: #9ca3af;
  font-size: 11px;
}
.lovart-job-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
.lovart-more-wrap {
  position: relative;
  display: flex;
}
.lovart-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #6b7280;
  font: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.lovart-more:hover {
  border-color: #e5e7eb;
  background: #f9fafb;
  color: #111827;
}
.lovart-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 132px;
  padding: 4px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(17, 24, 39, 0.12);
}
.lovart-menu-item {
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #374151;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.lovart-menu-item:hover:not(:disabled) {
  background: #f3f4f6;
  color: #111827;
}
.lovart-menu-item:disabled {
  color: #d1d5db;
  cursor: default;
}
.lovart-menu-danger {
  color: #b91c1c;
}
.lovart-menu-danger:hover:not(:disabled) {
  background: #fef2f2;
  color: #b91c1c;
}
.lovart-notice {
  margin: 0;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #f9fafb;
  color: #374151;
}
.lovart-prompt-text {
  margin: 0;
  color: #4b5563;
  overflow-wrap: anywhere;
}
.lovart-confirm {
  align-self: flex-start;
}
.lovart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}
.lovart-thumb-cell {
  position: relative;
}
.lovart-thumb {
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f3f4f6;
  cursor: zoom-in;
  overflow: hidden;
}
/* 与 .lovart-ghost 同一套白底细边；默认藏起来，hover / 键盘聚焦才出现。 */
.lovart-copy {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 6px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  color: #374151;
  font: inherit;
  font-size: 11px;
  line-height: 1.5;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.lovart-thumb-cell:hover .lovart-copy,
.lovart-thumb-cell:focus-within .lovart-copy {
  opacity: 1;
}
.lovart-copy:hover {
  border-color: #9ca3af;
  color: #111827;
}
.lovart-thumb-img {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
}
.lovart-lightbox {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.88);
  cursor: zoom-out;
}
.lovart-lightbox-img {
  max-width: 92vw;
  max-height: 92vh;
  object-fit: contain;
  border-radius: 8px;
  background: #ffffff;
}
.lovart-lightbox-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font: inherit;
  cursor: pointer;
}
.lovart-icon {
  width: 16px;
  height: 16px;
  color: #6b7280;
}
`

/** 幂等：多次挂载/热更新只留一个 style 节点。 */
export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
