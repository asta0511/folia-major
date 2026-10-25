import { useLibrarySuiteStore } from '../library/core/suite/useLibrarySuiteStore';
import { usePlaybackEntryViewStore } from './usePlaybackEntryViewStore';

// src/stores/siteStartupDefaults.ts
// 本站点定制（见 AI_HANDOFF §2.12）：首启引导已永久关闭（开关在 hooks/useStartupExperienceGate），
// 原本由那两页引导写下的答案在这里一次性补上，让已有浏览器也落到站点想要的默认：
//   资料库界面   → bravais（Bravais 无限）
//   播放后进入   → player（可视化）
// 同时把播放视图的「问过了」标记写下（setPlaybackEntryView 顺带写 playback_entry_view_chosen）；
// 资料库界面那一页的 library_suite_prompt_seen 不再需要——引导本身已经关了，没人会再来问。
//
// 只跑一次（标记键 folia_site_defaults_startup_v1）：之后用户在设置里改成网格、改成 Lattice 或
// 「留在原处」，都不会被这里覆盖回去。

const SITE_STARTUP_DEFAULTS_KEY = 'folia_site_defaults_startup_v1';

/** 站点想要的资料库界面。构建里没有这套 suite 时 registry 渲染会回退，不会白屏。 */
const SITE_DEFAULT_LIBRARY_SUITE = 'bravais';
/** 站点想要的「点击播放后进入」目标：player 即播放器与可视化视图。 */
const SITE_DEFAULT_PLAYBACK_ENTRY_VIEW = 'player';

export const applySiteStartupDefaults = (): void => {
    if (typeof window === 'undefined') return;
    try {
        if (localStorage.getItem(SITE_STARTUP_DEFAULTS_KEY) === '1') return;
        useLibrarySuiteStore.getState().setSuite(SITE_DEFAULT_LIBRARY_SUITE);
        usePlaybackEntryViewStore.getState().setPlaybackEntryView(SITE_DEFAULT_PLAYBACK_ENTRY_VIEW);
        localStorage.setItem(SITE_STARTUP_DEFAULTS_KEY, '1');
    } catch {
        // 存储不可用（隐私模式 / 配额满）时不用管：两处内置初值本来就是这个默认。
    }
};
