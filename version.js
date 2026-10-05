// This module is evaluated separately in the UI and the service worker.
// Compare loaded code versions, not getManifest(), which can hide stale workers.
export const BUILD='1.4.1';
export const MODE_OPTIONS={
  fonts:[['strict','常见字体白名单+DOM尺寸保护(Claude推荐)'],['normalize','隐藏指定中文字体（保留原回退字体）'],['native','保持原始字体行为']],
  emoji:[['flags','内置彩色国旗（Canvas 同步绘制）'],['native','保持原始 Emoji'],['text','优先文字 / 单色风格']],
  webrtc:[['block','阻断页面 WebRTC 连接（语音 / 视频通话可能不可用）'],['native','保持原始 WebRTC']]
};
export const MODE_VALUES=Object.fromEntries(Object.entries(MODE_OPTIONS).map(([key,options])=>[key,options.map(([value])=>value)]));
export function compatibleBackend(status){return status?.build===BUILD&&Object.entries(MODE_VALUES).every(([key,values])=>values.every(value=>status.modes?.[key]?.includes(value)));}
