import { APPLICATIONS_CLIENT_SCRIPT, AUTH_CLIENT_SCRIPT, HOME_DASHBOARD_SCRIPT, SHELL_CLIENT_SCRIPT, WEB_CLIENT_SCRIPT } from "./web-client.js";
import { renderApiPage, renderApplicationsPage, renderAuthPage, renderConstructionPage, renderDashboard, renderDocs, renderHome, renderJourneyPage } from "./web-components.js";
import { renderTool, renderToolboxHome } from "./web-toolbox.js";
import { TOOLBOX_HOME_SCRIPT, TOOLBOX_SCRIPTS } from "./toolbox-client.js";
import type { QaToolDefinition } from "./toolbox/catalog.js";
import { WEB_STYLES } from "./web-styles.js";

/**
 * Estilo da entrada e do cadastro.
 *
 * Bloco próprio porque só a página `/entrar` o usa; o aviso de e-mail não
 * confirmado, esse sim, vive em `NAV_RESPONSIVE_STYLES`, já que aparece no
 * cabeçalho de todas as páginas — componente compartilhado com CSS num arquivo
 * servido só em uma delas já rendeu bug em produção.
 */
const AUTH_STYLES = `
.auth-shell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;min-height:100vh;padding:32px 18px}
.auth-brand{display:flex;align-items:center;gap:11px;color:#f5f9ff;font-size:1.3rem;font-weight:800;letter-spacing:.055em;text-decoration:none}
.auth-brand .radar{width:28px;height:28px;border-radius:50%;border:2px solid var(--cyan);box-shadow:0 0 0 4px #0d2436 inset}
.auth-card{width:100%;max-width:404px;padding:26px 26px 24px;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:0 24px 60px #02080f66}
.auth-tabs{display:flex;gap:4px;margin-bottom:20px;padding:4px;border-radius:10px;background:#07101d}
.auth-tabs button{flex:1;width:auto;margin:0;padding:9px 10px;border:0;border-radius:7px;background:transparent;color:var(--muted);font-size:.83rem;font-weight:700;box-shadow:none}
.auth-tabs button:hover{transform:none;color:var(--text)}
.auth-tabs button.active{background:var(--panel2);color:var(--text)}
.auth-form h1{margin:0 0 5px;font-size:1.18rem;letter-spacing:-.01em}
.auth-lead{margin:0 0 18px;color:var(--muted);font-size:.82rem;line-height:1.55}
.auth-field{display:block;margin-bottom:14px}
.auth-field span{display:block;margin-bottom:6px;color:#c8d8ea;font-size:.79rem;font-weight:700}
.auth-field input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:#07101d;color:var(--text);font-size:.9rem}
.auth-field input:focus{outline:none;border-color:var(--cyan);box-shadow:0 0 0 3px #17c3e422}
.auth-field small{display:block;margin-top:6px;color:var(--muted);font-size:.73rem;line-height:1.45}
.auth-form>button[type=submit]{width:100%;margin:4px 0 0;padding:12px}
.auth-link{width:auto;margin:14px auto 0;padding:0;display:block;border:0;background:none;color:var(--cyan);font-size:.78rem;font-weight:700;box-shadow:none}
.auth-link:hover{transform:none;text-decoration:underline}
.auth-link[hidden]{display:none}
.auth-alert{margin:0 0 16px;padding:11px 13px;border-radius:8px;font-size:.79rem;line-height:1.5}
.auth-alert[hidden]{display:none}
.auth-alert-error{border:1px solid #6d2634;background:#2a1119;color:#ffc7d1}
.auth-alert-ok{border:1px solid #1f5d4f;background:#0c2620;color:#a9e8d5}
.auth-external{margin-top:20px}
.auth-external[hidden]{display:none}
.auth-divider{display:flex;align-items:center;gap:10px;margin-bottom:14px;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.1em}
.auth-divider i{flex:1;height:1px;background:var(--line)}
.auth-github{display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;border:1px solid var(--line);border-radius:8px;background:#07101d;color:#d9e7f7;font-size:.85rem;font-weight:700;text-decoration:none}
.auth-github:hover{border-color:var(--cyan);color:var(--cyan)}
.auth-foot{margin:0;color:var(--muted);font-size:.75rem;text-align:center}
.auth-foot a{color:var(--cyan)}
@media(max-width:460px){.auth-card{padding:22px 18px}}
`;

const APPLICATIONS_STYLES = `
.applications-layout{display:grid;grid-template-columns:minmax(0,380px) minmax(0,1fr);gap:18px;align-items:start}
.application-list{display:flex;flex-direction:column;gap:11px;margin-top:14px}
.application-item{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 15px;border:1px solid var(--line);border-radius:10px;background:#07101d}
.application-info{min-width:0}
.application-info strong{display:block;color:var(--text);font-size:.92rem}
.application-info a{display:block;margin-top:3px;color:var(--muted);font-size:.78rem;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.application-info a:hover{color:var(--cyan)}
.application-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.application-tags span{padding:2px 8px;border:1px solid var(--line);border-radius:999px;color:#9db0c2;font-size:.7rem}
.application-actions{display:flex;gap:6px;flex:0 0 auto}
.application-actions button{width:auto;margin:0;padding:6px 11px;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--muted);font-size:.73rem;font-weight:700;box-shadow:none}
.application-actions button:hover{transform:none;color:var(--text);border-color:var(--cyan)}
@media(max-width:900px){.applications-layout{grid-template-columns:minmax(0,1fr)}}
@media(max-width:560px){.application-item{flex-direction:column;align-items:stretch}.application-actions{justify-content:flex-start;flex-wrap:wrap}}
`;

const NAV_RESPONSIVE_STYLES = `
.run-source{margin-left:8px;padding:2px 9px;border:1px solid #1f5d4f;border-radius:999px;background:#0c2620;color:#a9e8d5;font-size:.68rem;font-weight:700;letter-spacing:.04em}
.run-source[hidden]{display:none}
.application-picker[hidden]{display:none}
.application-picker a{color:var(--cyan)}
.verify-banner{display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin:0;padding:10px 22px;border-bottom:1px solid #5c4a15;background:#201a06;color:#f0dca4;font-size:.79rem}
.verify-banner[hidden]{display:none}
.verify-banner button{width:auto;margin:0;padding:5px 12px;border:1px solid #6b5619;border-radius:999px;background:transparent;color:#f0dca4;font-size:.73rem;font-weight:700;box-shadow:none}
.verify-banner button:hover{transform:none;border-color:#f0dca4}
.verify-state{color:#c9b981;font-size:.74rem}
.verify-state[hidden]{display:none}
@media(max-width:560px){.verify-banner{padding:10px 14px}}
.context-account{display:flex;align-items:center;gap:10px;margin-left:auto}.context-account[hidden]{display:none}.account-signin{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border:1px solid #2a4d66;border-radius:999px;background:#0f2537;color:var(--cyan);font-size:.78rem;font-weight:700;text-decoration:none;white-space:nowrap}.account-signin[hidden]{display:none}.account-signin:hover{border-color:var(--cyan)}.account-user{display:flex;align-items:center;gap:9px}.account-user[hidden]{display:none}.account-avatar{border-radius:50%;background:#0f2537;flex:0 0 auto}.account-login{font-size:.78rem;font-weight:700;color:#d9e7f7;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-signout{width:auto;margin:0;padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--muted);font-size:.72rem;font-weight:700;box-shadow:none}.account-signout:hover{transform:none;color:var(--text);border-color:var(--cyan)}@media(max-width:760px){.account-login{display:none}}

body{background:#06111c;color:#e9f3ff}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(#16304724 1px,transparent 1px),linear-gradient(90deg,#16304724 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(to bottom,#0008,transparent 70%)}
.shell{position:relative;display:grid;grid-template-columns:240px minmax(0,1fr);max-width:none;min-height:100vh;margin:0;padding:0}
.app-sidebar{position:sticky;top:0;z-index:20;display:flex;flex-direction:column;height:100vh;padding:0 11px 16px;background:linear-gradient(180deg,#07131f,#06121d);border-right:1px solid #183047}
.sidebar-brand{display:flex;align-items:center;justify-content:space-between;min-height:64px;padding:0 8px;border-bottom:1px solid #183047}
.app-sidebar .logo{display:flex;align-items:center;gap:11px;padding:0;color:#f5f9ff;font-size:1.25rem;letter-spacing:.055em;text-decoration:none}
.app-sidebar .logo .radar{width:28px;height:28px}
.mobile-nav-toggle{position:relative;display:none;width:38px;height:38px;margin:0;padding:0;border:1px solid #1d3b50;border-radius:4px;background:#091a28;box-shadow:none}.mobile-nav-toggle:hover{transform:none}.mobile-nav-toggle i,.mobile-nav-toggle:before,.mobile-nav-toggle:after{content:"";position:absolute;left:10px;width:16px;height:1.5px;background:#b9ccdd;transition:.18s}.mobile-nav-toggle i{top:17px}.mobile-nav-toggle:before{top:12px}.mobile-nav-toggle:after{top:22px}.nav-open .mobile-nav-toggle i{opacity:0}.nav-open .mobile-nav-toggle:before{top:17px;transform:rotate(45deg)}.nav-open .mobile-nav-toggle:after{top:17px;transform:rotate(-45deg)}
.app-sidebar nav{display:grid;align-content:start;margin:18px -1px 0 -11px;scrollbar-width:none}
.app-sidebar nav::-webkit-scrollbar{display:none}
.nav-group{display:grid;gap:4px}.nav-group+.nav-group{margin-top:14px;padding-top:14px;border-top:1px solid #183047}.nav-group-label{margin:0 13px 5px;color:#526b81;font-size:.53rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase}
.app-sidebar .nav-link{position:relative;display:flex;align-items:center;gap:12px;min-height:53px;padding:0 24px;border:1px solid transparent;border-radius:0 4px 4px 0;color:#9eb0c3;text-decoration:none;font-size:.8rem;font-weight:650;white-space:nowrap;transition:background .18s,border-color .18s,color .18s}
.app-sidebar .nav-link:hover{background:#0a1d2c;border-color:#132f43;color:#e9f3ff}.app-sidebar .nav-link:focus-visible{outline:2px solid #35dbf4;outline-offset:1px}
.app-sidebar .nav-link.active{background:linear-gradient(90deg,#0b2a3d,#0a1d2b);border-color:#173b50;color:#35dbf4;box-shadow:inset 14px 0 24px #0b354644}
.app-sidebar .nav-link.active:before{content:"";position:absolute;left:0;top:-1px;bottom:-1px;width:3px;background:#35dbf4;box-shadow:0 0 10px #35dbf477}
.nav-icon{position:relative;display:grid;place-items:center;width:22px;height:22px;flex:0 0 22px;color:#c7d6e7}
.nav-link.active .nav-icon{color:#35dbf4}.nav-link:hover .nav-icon{color:#e4f3ff}
.icon-overview,.icon-inspection,.icon-journey,.icon-api,.icon-docs,.icon-reports,.icon-quality,.icon-alerts,.icon-environments,.icon-settings,.icon-toolbox{position:relative}
.icon-toolbox:before{content:"";position:absolute;left:2px;top:7px;width:18px;height:12px;border:1.5px solid currentColor;border-radius:2px}.icon-toolbox:after{content:"";position:absolute;left:7px;top:3px;width:8px;height:5px;border:1.5px solid currentColor;border-bottom:0;border-radius:2px 2px 0 0}.icon-toolbox i{position:absolute;left:2px;top:12px;width:18px;height:1.5px;background:currentColor}
.icon-overview:before{content:"";position:absolute;inset:3px;border:1.5px solid currentColor;border-radius:50%}.icon-overview i{width:6px;height:6px;border:1.5px solid currentColor;border-radius:50%}.icon-overview:after{content:"";position:absolute;left:50%;top:1px;width:1px;height:4px;background:currentColor}
.icon-inspection:before{content:"";position:absolute;left:3px;top:2px;width:10px;height:10px;border:1.5px solid currentColor;border-radius:50%}.icon-inspection:after{content:"";position:absolute;left:13px;top:13px;width:7px;height:1.5px;background:currentColor;transform:rotate(45deg);transform-origin:left center}
.icon-journey:before{content:"";position:absolute;left:4px;bottom:3px;width:13px;height:10px;border-left:1.5px dashed currentColor;border-bottom:1.5px dashed currentColor;border-radius:0 0 0 10px;transform:rotate(-12deg)}.icon-journey i{position:absolute;right:2px;top:1px;width:7px;height:7px;border:1.5px solid currentColor;border-radius:50%}.icon-journey i:after{content:"";position:absolute;left:2px;top:6px;width:1.5px;height:6px;background:currentColor}
.icon-api:before,.icon-api:after{position:absolute;top:2px;color:currentColor;font:700 15px/18px ui-monospace,SFMono-Regular,Consolas,monospace}.icon-api:before{content:"{";left:1px}.icon-api:after{content:"}";right:1px}.icon-api i{width:3px;height:3px;border-radius:50%;background:currentColor}
.icon-docs:before{content:"";position:absolute;left:4px;top:2px;width:13px;height:17px;border:1.5px solid currentColor;border-radius:2px}.icon-docs:after{content:"";position:absolute;left:7px;top:7px;width:7px;height:1px;background:currentColor;box-shadow:0 4px 0 currentColor,0 8px 0 currentColor}
.icon-reports:before{content:"";position:absolute;left:4px;top:2px;width:13px;height:17px;border:1.5px solid currentColor;border-radius:2px}.icon-reports:after{content:"";position:absolute;left:7px;top:7px;width:7px;height:1px;background:currentColor;box-shadow:0 4px 0 currentColor,0 8px 0 currentColor}.icon-quality:before{content:"";position:absolute;inset:3px;border:1.5px solid currentColor;border-radius:50%;box-shadow:0 0 0 3px #07131f,0 0 0 4px currentColor}.icon-quality i{width:4px;height:4px;border-radius:50%;background:currentColor}.icon-alerts:before{content:"";position:absolute;left:6px;top:3px;width:10px;height:13px;border:1.5px solid currentColor;border-radius:7px 7px 3px 3px}.icon-alerts:after{content:"";position:absolute;left:9px;bottom:1px;width:5px;height:1.5px;background:currentColor}.icon-environments:before,.icon-environments:after{content:"";position:absolute;width:10px;height:10px;border:1.5px solid currentColor;transform:rotate(30deg)}.icon-environments:before{left:2px;top:8px}.icon-environments:after{right:1px;top:2px}.icon-settings:before{content:"";position:absolute;inset:3px;border:1.5px dashed currentColor;border-radius:50%}.icon-settings i{width:5px;height:5px;border:1.5px solid currentColor;border-radius:50%}
.sidebar-help{display:flex;align-items:center;gap:12px;min-height:42px;margin-top:auto;padding:0 13px;border:1px solid transparent;border-radius:4px;background:#0a1b29;color:#a9bacb;text-decoration:none;font-size:.74rem}.sidebar-help:hover,.sidebar-help.active{border-color:#1b3a50;color:#e8f4ff}.help-mark{display:grid;place-items:center;width:18px;height:18px;border:1px solid currentColor;border-radius:50%;font-size:.68rem;font-weight:800}
.live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#2fd3b0;box-shadow:0 0 12px #2fd3b088}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.live-state{display:inline-flex;align-items:center}.live-state[data-state="connecting"] .live-dot{background:#f0ad36;box-shadow:0 0 10px #f0ad3670;animation:live-pulse 1.4s ease-in-out infinite}.live-state[data-state="offline"] .live-dot{background:#6f8496;box-shadow:none}@keyframes live-pulse{50%{opacity:.35}}
.app-main{min-width:0}
.context-bar{position:sticky;top:0;z-index:15;display:flex;align-items:stretch;min-height:64px;margin:0;border-bottom:1px solid #183047;background:#07131ff2;backdrop-filter:blur(12px)}
.home-shell{--signal-col:292px}.home-shell .context-bar{padding-right:var(--signal-col)}
.context-item{position:relative;display:flex;flex-direction:column;justify-content:center;min-width:205px;padding:9px 24px;border-right:1px solid #183047}.context-item:after{content:"⌄";position:absolute;right:16px;top:24px;color:#8ba0b3;font-size:.8rem}.context-environment{min-width:235px}
/* O seletor de ambiente cobre o bloco inteiro: o visual continua o da barra e o controle é um select de verdade. */
.context-environment select{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;border-radius:0;opacity:0;cursor:pointer;-webkit-appearance:none;appearance:none}
.context-environment:hover{background:#0b1b29}.context-environment:focus-within{outline:2px solid #35dbf4;outline-offset:-2px}
.context-environment[data-environment="homologacao"] .live-dot{background:#f4ae38;box-shadow:0 0 12px #f4ae3888}
.context-environment[data-environment="producao"] .live-dot{background:#35dbf4;box-shadow:0 0 12px #35dbf488}
.context-item small{color:#6f879e;font-size:.61rem}.context-item strong{display:flex;align-items:center;gap:7px;margin-top:4px;color:#dce9f7;font-size:.76rem;font-weight:700}
.context-section{display:flex;align-items:center;gap:18px;margin-left:auto;padding:0 20px;color:#7890a7;font-size:.68rem}/* #617b92 ficava em 4.28:1 sobre a barra e reprovava no axe-core em toda página. */
.context-page{padding-right:18px;border-right:1px solid #183047;color:#6d88a0;font-weight:700}.context-clock{display:flex;align-items:center;gap:9px;color:#9db0c2;font-variant-numeric:tabular-nums}.context-clock i{position:relative;width:14px;height:14px;border:1px solid #7890a7;border-radius:2px}.context-clock i:before{content:"";position:absolute;left:2px;right:2px;top:3px;height:1px;background:#7890a7}.context-clock i:after{content:"";position:absolute;left:3px;top:-3px;width:6px;height:4px;border-left:1px solid #7890a7;border-right:1px solid #7890a7}.context-period{display:inline-flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid #1d3b50;border-radius:4px;background:#091a28;color:#b9cad9;white-space:nowrap}.context-period:after{content:"⌄";margin-top:-5px;color:#8ba0b3;font-size:.8rem}
.app-page{--page-max:1120px;padding:24px 24px 42px}.app-page-scanner,.app-page-journeys{--page-max:860px}
.home-shell .app-page{padding-top:16px;padding-right:0;padding-bottom:0}
.app-page>.tool-header{max-width:var(--page-max);margin:0 auto 20px;text-align:left}.app-page .results{max-width:var(--page-max);margin-left:auto;margin-right:auto}
.tool-header .eyebrow{margin-bottom:5px}.tool-header h1{margin:0;font-size:2rem}.tool-header p{max-width:none;margin:7px 0 0;color:#7890a7}
.app-page .panel{border-color:#1a344a;border-radius:6px;background:#091724;box-shadow:none;backdrop-filter:none}
.app-page input,.app-page select,.app-page textarea{border-radius:4px;background:#07131f}
.app-page button{border-radius:4px}
.app-page /* #60768b ficava em 4.03:1 a 10.4px e reprovava no axe-core em toda página. */
footer{max-width:var(--page-max);margin:28px auto 0;padding-top:18px;border-top:1px solid #163047;color:#7b8ea6;font-size:.65rem}
.home-shell footer{display:none}
.overview-header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;max-width:none;margin:0 0 12px;padding-right:24px}
.overview-header h1{margin:0;font-size:2.2rem}.overview-header p{margin:5px 0 0;color:#7890a7;font-size:.82rem}
.home-shell .context-page{display:none}
.overview-docs-link{color:#35dbf4;text-decoration:none;font-size:.76rem}
.home-dashboard{display:grid;grid-template-columns:minmax(0,1fr) var(--signal-col);max-width:none;margin:0 0 0 -24px;border:1px solid #19354a;border-right:0;background:#071521}.dashboard-primary{min-width:0}.overview-grid{display:grid;grid-template-columns:minmax(330px,.95fr) minmax(380px,1.05fr);border-bottom:1px solid #19354a;background:#071521}
.overview-grid>*{min-width:0}
.section-kicker{display:flex;align-items:center;justify-content:space-between;color:#88a0b6;font-size:.66rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
.quality-map{position:relative;min-height:447px;padding:0 28px 12px;border-right:1px solid #19354a;overflow:hidden}
.quality-metrics span{position:absolute;z-index:4}.quality-metrics small,.quality-metrics strong,.quality-metrics em{display:block}.quality-metrics small{color:#8ba0b3;font-size:.68rem}.quality-metrics strong{margin-top:1px;font-size:2.2rem;font-weight:400;line-height:1.05;letter-spacing:-.01em}.quality-delta{margin-top:5px;color:#7890a7;font-size:.6rem;font-style:normal;white-space:nowrap}.quality-delta:empty{display:none}.quality-delta.up:before{content:"▲ ";color:#ff625c}.quality-delta.down:before{content:"▼ ";color:#35d495}
.quality-errors{left:34px;top:22px}.quality-errors strong{color:#ff625c}.quality-performance{right:34px;top:22px;text-align:right}.quality-performance strong{color:#f4ae38}.quality-performance .quality-delta.up:before{color:#35d495}.quality-performance .quality-delta.down:before{color:#ff625c}.quality-warnings{right:34px;bottom:66px;text-align:right}.quality-warnings strong{color:#f4ae38}.quality-accessibility{left:34px;bottom:66px}.quality-accessibility strong{color:#35d495}.quality-accessibility .quality-delta.up:before{color:#35d495}.quality-accessibility .quality-delta.down:before{color:#ff625c}
.map-legend{position:absolute;left:0;right:0;bottom:38px;z-index:4;justify-content:center;color:#a4b8ca;letter-spacing:.11em}
.radar-visual{position:relative;width:min(100%,390px);aspect-ratio:1;margin:13px auto 0;transform:translateX(-14px)}
.radar-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.radar-rings circle{fill:none;stroke:#28506c;stroke-width:1;opacity:.55}
.radar-rings circle:first-child{opacity:.8;fill:#0a1e2d33}
.radar-spokes line{stroke:#27495f;stroke-width:1;opacity:.7}
.radar-area{fill:#35dbf412;stroke:#35dbf4;stroke-width:2;stroke-linejoin:round;filter:drop-shadow(0 0 4px #35dbf466);transition:points .45s ease}
.radar-dot{fill:#137d94;stroke:#a9f6ff;stroke-width:1.5;filter:drop-shadow(0 0 5px #35dbf4)}
.radar-scale text{fill:#7b93a8;font:500 13px/1 ui-monospace,SFMono-Regular,Consolas,monospace;text-anchor:middle;paint-order:stroke;stroke:#071521;stroke-width:4px;stroke-linejoin:round}
.radar-center{position:absolute;left:50%;top:50%;z-index:3;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;width:118px;height:118px;transform:translate(-50%,-50%);border:1px solid #35dbf4;border-radius:50%;background:#071521;text-align:center;box-shadow:0 0 30px #35dbf41f}.radar-center div{display:flex;align-items:baseline}.radar-center strong{color:#edf9ff;font-size:2rem;line-height:1;letter-spacing:.03em}.radar-center div span{margin-left:3px;color:#7890a7;font-size:.68rem}.radar-center small{margin-top:5px;color:#91a8bc;font-size:.54rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.radar-center em{margin-top:3px;color:#35dbf4;font-size:.55rem;font-style:normal;text-transform:uppercase}
.radar-axis{display:none}
.map-status{position:absolute;left:0;right:0;bottom:16px;margin:0;text-align:center;color:#7890a7;font-size:.66rem}.map-status .live-dot{margin-right:5px}
.execution-panel{position:relative;padding:0 20px 20px;border-right:1px solid #19354a;background:linear-gradient(145deg,#071521,#081927)}.execution-panel>.section-kicker{position:absolute;left:20px;right:20px;top:-22px}
.execution-list{display:grid;gap:10px;margin-top:0}
.execution-card{display:grid;grid-template-columns:58px minmax(0,1fr) 158px;align-items:center;gap:16px;min-height:122px;padding:17px 18px;border:1px solid #1b3a50;border-radius:4px;background:linear-gradient(90deg,#091a28,#081724);color:#edf7ff;text-decoration:none;transition:border-color .18s,background .18s,transform .18s}
.execution-card:hover{border-color:#2d6680;background:#0a2030;transform:translateY(-1px)}.execution-card:focus-visible{outline:2px solid #35dbf4;outline-offset:2px}.execution-icon{display:grid;place-items:center;width:54px;height:54px;border:1px solid #52718a;border-radius:50%;color:#c9deed;box-shadow:inset 0 0 18px #16364b55}.execution-icon-plain{border-color:transparent;box-shadow:none}.execution-icon-plain .tool-icon{width:48px;height:48px}.execution-icon-plain .icon-api:before,.execution-icon-plain .icon-api:after{top:5px;font-size:30px;line-height:34px}.tool-icon{position:relative;display:grid;place-items:center;width:25px;height:25px;color:currentColor;font-style:normal}
.execution-copy strong,.execution-copy small,.execution-action b,.execution-action small{display:block}.execution-copy strong{font-size:1.03rem}.execution-copy small{max-width:310px;margin-top:6px;color:#849bb0;font-size:.69rem;line-height:1.5}.execution-action{display:grid;gap:8px;align-items:center}.execution-action b{padding:11px 10px;border:1px solid #26cce7;border-radius:3px;background:linear-gradient(180deg,#35d9ef,#22bfdc);color:#03121b;text-align:center;font-size:.68rem;letter-spacing:.01em;box-shadow:0 0 18px #28cbe41b}.execution-action small{margin:0;color:#667f95;font-size:.58rem;text-align:center;white-space:nowrap}
.execution-card:hover .execution-action b{border-color:#79ecfb}.execution-card:hover .execution-icon{border-color:#75a2bd;color:#e2f4ff}
.executions-link{position:absolute;right:20px;bottom:18px;display:flex;align-items:center;gap:14px;color:#35dbf4;text-decoration:none;font-size:.67rem}
/* O bloco fica dentro da moldura do painel; só o kicker sobe para a faixa do título,
   como no painel de execuções — puxar a coluna inteira fazia a borda cortar o primeiro sinal. */
.live-signal{position:relative;display:flex;flex-direction:column;min-width:0;padding:20px;border-left:1px solid #19354a}
.signal-kicker{position:absolute;left:20px;right:20px;top:-22px;justify-content:flex-start;gap:8px}
.signal-list{display:grid;margin:0 -20px}.signal-event{position:relative;display:grid;grid-template-columns:34px 10px minmax(0,1fr);gap:9px;padding:13px 16px;color:#eaf5ff;text-decoration:none}.signal-event:hover{background:#0a1b29}.signal-event time{margin-top:1px;color:#70889e;font-size:.62rem;font-variant-numeric:tabular-nums}
/* A linha do tempo acompanha a altura real de cada sinal: títulos longos ocupam duas linhas sem descolar do traço. */
.signal-event>i{position:relative;align-self:stretch;width:7px;margin:0;border:0;background:none}.signal-event>i:before{content:"";position:absolute;left:3px;top:0;bottom:0;width:1px;background:#25455c}.signal-event:first-child>i:before{top:9px}.signal-event:last-child>i:before{bottom:auto;height:9px}.signal-event:first-child:last-child>i:before{display:none}.signal-event>i:after{content:"";position:absolute;left:0;top:5px;width:7px;height:7px;border:1px solid #35d495;border-radius:50%;background:#071521}.signal-event.error>i:after{border-color:#ff625c}.signal-event.warning>i:after{border-color:#f4ae38}
.signal-event span b,.signal-event span strong,.signal-event span small{display:block}.signal-event span b{display:flex;align-items:center;gap:6px;color:#35d495;font-size:.6rem;font-weight:800;letter-spacing:.04em}.signal-event span b:before{content:"✓";display:grid;place-items:center;width:14px;height:14px;flex:0 0 14px;border:1px solid currentColor;border-radius:50%;font-size:.52rem;font-weight:900}.signal-event.error span b{color:#ff625c}.signal-event.error span b:before{content:"✕"}.signal-event.warning span b{color:#f4ae38}.signal-event.warning span b:before{content:"!";border-radius:2px;border-width:0;font-size:.68rem}
.signal-event>span{min-width:0}
.signal-event span strong{margin-top:5px;font-size:.65rem;font-weight:600;line-height:1.35;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
.signal-event span small{margin-top:3px;color:#8097ab;font-size:.62rem;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
.signal-empty{display:grid;place-items:center;flex:1;min-height:230px;padding:18px;text-align:center}.signal-empty[hidden]{display:none}.signal-empty i{color:#35dbf4;font-size:2rem}.signal-empty strong{margin-top:10px;font-size:.82rem}.signal-empty p{max-width:190px;margin:7px 0 0;color:#7890a7;font-size:.68rem;line-height:1.5}.signals-link{display:flex;justify-content:space-between;margin-top:auto;padding:15px 0;border-top:1px solid #19354a;color:#35dbf4;text-decoration:none;font-size:.67rem}
.quality-center-card{display:grid;grid-template-columns:42px 1fr;gap:12px;margin-top:0;padding:16px 10px;border:1px solid #19354a;border-radius:4px;background:#081825;color:#dce9f7;text-decoration:none}.quality-center-icon{display:grid;place-items:center;width:40px;height:40px;border:1px solid #1f7086;border-radius:50%;color:#35dbf4}.quality-center-icon>i{display:grid;place-items:center;width:28px;height:28px}.quality-center-card>span>strong,.quality-center-card>span>small,.quality-center-card>span>b{display:block}.quality-center-card>span>strong{color:#35dbf4;font-size:.6rem;text-transform:uppercase}.quality-center-card>span>small{margin-top:7px;color:#8298ac;font-size:.57rem;line-height:1.5}.quality-center-card>span>b{margin-top:12px;color:#35dbf4;font-size:.61rem}.quality-center-card>span>b i{float:right;font-style:normal}
.recent-runs{min-height:347px;background:#071521}
.recent-head{display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:52px;padding:10px 18px;border-bottom:1px solid #19354a}.run-count{margin-left:8px;color:#60778d;font-size:.52rem;font-weight:500;letter-spacing:0;text-transform:none}.recent-controls{display:flex;align-items:center;gap:14px}.dashboard-filters{display:flex;align-self:end;gap:2px}.dashboard-filters button{width:auto;margin:0;padding:7px 9px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;box-shadow:none;color:#71899f;font-size:.6rem}.dashboard-filters button:hover{transform:none;color:#d8e8f6}.dashboard-filters button.active{border-bottom-color:#35dbf4;color:#35dbf4}.history-toggle{display:inline-flex;align-items:center;gap:9px;width:auto;margin:0;padding:9px 12px;border:1px solid #24455c;border-radius:3px;background:#091a28;box-shadow:none;color:#a9bdce;font-size:.63rem;font-weight:500}.history-toggle:before{content:"";position:relative;width:12px;height:11px;flex:0 0 12px;border:1px solid currentColor;border-top:3px solid currentColor;border-radius:2px}.history-toggle:hover{transform:none;border-color:#35dbf4;color:#35dbf4}.history-toggle[hidden]{display:none}
.dashboard-table-head{display:none}
.dashboard-run{display:grid;grid-template-columns:38px minmax(0,1.35fr) minmax(0,84px) minmax(0,84px) minmax(0,74px) minmax(0,80px) minmax(0,68px) minmax(0,74px) minmax(0,44px) minmax(0,50px) 24px 18px;align-items:center;gap:9px;padding-inline:18px}.dashboard-run>*{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.dashboard-runs{display:grid}.dashboard-run{min-height:54px;padding-block:7px;border-bottom:1px solid #122a3d;color:#e7f1fa;font-size:.66rem}.dashboard-run:last-child{border-bottom:0}.dashboard-run:hover{background:#0a1b29}.run-kind{position:relative;display:grid;place-items:center;width:30px;height:30px;border:1px solid #29495f;border-radius:50%;color:#9fc4d8}.run-title{min-width:0;color:#e7f1fa;text-decoration:none}.run-title strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.72rem;font-weight:500}.run-title small{display:block;margin-top:2px;color:#71899f;font-size:.57rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.run-environment,.run-duration,.dashboard-run time{color:#8ba0b3}.run-status{font-size:.6rem;font-weight:800}.run-status i{display:inline-block;width:6px;height:6px;margin-right:6px;border-radius:50%;background:#35d495}.run-status.error{color:#ff625c}.run-status.error i{background:#ff625c}.run-status.success{color:#35d495}.run-errors,.run-warnings,.run-score{color:#5d7488;font-variant-numeric:tabular-nums}.run-errors.has-value{color:#ff625c}.run-warnings.has-value{color:#f4ae38}.run-score.has-value{color:#35d495}
.run-play,.run-action{display:grid;place-items:center;color:#8fb6cb;text-decoration:none}.run-play{width:24px;height:24px;font-size:.86rem}.run-action{width:20px;height:20px;font-size:1rem}.run-play:hover,.run-action:hover{color:#35dbf4}
.recent-empty{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:15px;padding:20px}.recent-empty>span{display:grid;place-items:center;width:38px;height:38px;border:1px solid #26465d;border-radius:50%;color:#35dbf4}.recent-empty strong{font-size:.78rem}.recent-empty p{margin:4px 0 0;color:#7890a7;font-size:.68rem}.recent-empty a{padding:9px 12px;border:1px solid #28cbe4;border-radius:3px;color:#35dbf4;text-decoration:none;font-size:.67rem}
.recent-empty[hidden]{display:none}
.docs-panel{border-radius:6px!important}
.app-page-construcao{--page-max:720px}
.construction-panel{max-width:var(--page-max);margin:32px auto 0;padding:40px;text-align:center}
.construction-panel .eyebrow{margin-bottom:6px}.construction-panel h1{margin:0;font-size:2rem}
.construction-panel .lead{max-width:520px;margin:12px auto 0;color:#9db2c5;font-size:.86rem;line-height:1.6}
.construction-note{max-width:520px;margin:14px auto 0;color:#7890a7;font-size:.76rem;line-height:1.6}
.construction-mark{position:relative;display:grid;place-items:center;width:78px;height:78px;margin:0 auto 22px;border:1px solid #1f7086;border-radius:50%;box-shadow:inset 0 0 26px #16364b66}
.construction-mark:before{content:"";position:absolute;inset:12px;border:1px dashed #35dbf4;border-radius:50%;opacity:.55;animation:live-pulse 2.6s ease-in-out infinite}
.construction-mark i{width:32px;height:13px;border-radius:2px;background:repeating-linear-gradient(45deg,#35dbf4,#35dbf4 4px,#0b2635 4px,#0b2635 8px)}
.construction-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:26px}
.construction-actions a{padding:11px 16px;border:1px solid #24455c;border-radius:3px;color:#c6dbec;text-decoration:none;font-size:.72rem}
.construction-actions a:first-child{border-color:#28cbe4;color:#35dbf4}
.construction-actions a:hover{border-color:#35dbf4;color:#35dbf4}
/* Em telas médias a coluna do botão espremia a descrição a uma palavra por linha:
   abaixo desta largura a ação desce para baixo do texto e a descrição volta a respirar. */
@media(max-width:1460px){.execution-card{grid-template-columns:54px minmax(0,1fr);gap:14px;min-height:0;padding:16px}.execution-copy small{max-width:none}.execution-action{grid-column:2;display:flex;flex-wrap:wrap;justify-content:flex-start;align-items:center;gap:7px 14px;margin-top:2px}.execution-action b{padding-inline:20px;white-space:nowrap}.execution-action small{text-align:left;white-space:nowrap;line-height:1.4}}
@media(max-width:1240px){.context-item,.context-environment{min-width:170px;padding-inline:16px}.context-page{display:none}.context-section{gap:10px;padding-inline:14px}.home-shell .context-bar{padding-right:0}.home-dashboard{grid-template-columns:1fr}.overview-grid{grid-template-columns:minmax(300px,.8fr) 1.2fr}.live-signal{margin-top:0;border-left:0;border-top:1px solid #19354a}.signal-kicker{position:static;margin-bottom:12px}.signal-empty{min-height:150px}.execution-panel{border-right:0}}
@media(max-width:1425px){.dashboard-run{grid-template-columns:38px minmax(0,1.3fr) minmax(0,84px) minmax(0,74px) minmax(0,80px) minmax(0,68px) minmax(0,74px) minmax(0,44px) 24px 18px}.run-environment,.run-duration{display:none}}
@media(max-width:860px){
  .shell{display:block}.app-sidebar{position:sticky;height:auto;padding:0 12px 10px;border-right:0;border-bottom:1px solid #183047}.sidebar-brand{min-height:58px;padding:0 7px}.app-sidebar .logo{font-size:.94rem}.mobile-nav-toggle{display:block}.app-sidebar nav{display:none;margin:10px 0 0;padding-top:10px;border-top:1px solid #183047}.app-sidebar.nav-open nav{display:grid}.nav-group+.nav-group{margin-top:9px;padding-top:9px}.app-sidebar .nav-link{min-height:42px;padding:0 11px;border-radius:4px}.app-sidebar .nav-link.active:before{left:0;top:6px;bottom:6px;width:2px;height:auto}.sidebar-help{display:none}.context-bar{top:59px;min-height:52px}.context-item,.context-environment{min-width:0;padding:7px 14px}.context-section{gap:10px;padding:0 14px}.context-page{display:none}.app-page,.home-shell .app-page{padding:20px 14px 34px}.home-dashboard{margin-left:0}.overview-grid{grid-template-columns:1fr}.quality-map,.execution-panel{border-right:0;border-bottom:1px solid #19354a}.quality-map{min-height:0;padding:16px}.map-legend{position:static;justify-content:flex-start;margin-top:14px}.quality-errors{left:16px;top:44px}.quality-performance{right:16px;top:44px}.quality-warnings{right:16px;bottom:96px}.quality-accessibility{left:16px;bottom:96px}.map-status{position:static;margin:8px 0 0}.execution-panel{padding:16px}.execution-panel>.section-kicker{position:static}.execution-list{margin-top:14px}.executions-link{position:static;justify-content:flex-end;margin-top:14px}.radar-visual{max-width:360px;transform:none}.recent-runs{min-height:0}.recent-head{flex-wrap:wrap;gap:10px}.recent-controls{width:100%;justify-content:space-between}.dashboard-filters{overflow-x:auto}.dashboard-run{grid-template-columns:34px minmax(0,1fr) minmax(0,78px) minmax(0,68px) minmax(0,74px) minmax(0,44px) 24px 18px}.run-environment,.run-errors,.run-warnings,.run-duration{display:none}
}
@media(max-width:560px){
  .app-sidebar .nav-link{gap:7px;font-size:.72rem}.nav-icon{width:18px;flex-basis:18px}.context-item{padding:7px 10px}.context-item:first-child{display:none}.context-clock{display:none}.context-section{padding:0 10px}.context-period{padding:7px 9px;font-size:.59rem}.overview-header{align-items:flex-start}.overview-docs-link{display:none}.overview-header h1{font-size:1.8rem}.quality-map{padding:16px}.quality-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.quality-metrics span{position:static;padding:8px;border:1px solid #173348;background:#081725}.quality-performance,.quality-warnings{text-align:right}.quality-metrics strong{font-size:1.25rem}.quality-delta{margin-top:3px}.execution-panel{padding:16px}.execution-card{grid-template-columns:42px minmax(0,1fr);gap:12px;min-height:auto;padding:13px}.execution-icon{width:38px;height:38px}.execution-action{grid-column:2;grid-template-columns:max-content 1fr;align-items:center}.execution-action b{padding:8px 10px;text-align:left;width:max-content}.execution-action small{text-align:left;white-space:normal}.recent-controls{display:grid;gap:7px}.history-toggle{width:100%}.dashboard-run{grid-template-columns:34px minmax(0,1fr) auto 24px 18px}.run-environment,.run-errors,.run-warnings,.run-score,.run-duration,.dashboard-run time{display:none}.recent-empty{grid-template-columns:auto 1fr}.recent-empty a{grid-column:2;width:max-content}.app-page>.tool-header h1{font-size:1.65rem}
}`;

// Compartilhado entre a página de Jornada e a de Testes de API — ambas usam
// o mesmo #code-mode-panel (editor Playwright, botões de ação, resultado).
const CODE_MODE_STYLES = `.journey-workspace{max-width:860px;margin:0 auto}#code-mode-panel{max-width:860px;margin:0 auto}#code-mode-panel textarea{display:block;width:100%;min-height:420px;resize:vertical;background:#07101d;border:1px solid #344964;color:#d8e8f8;border-radius:10px;padding:16px;font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;outline:0;tab-size:2}#code-mode-panel textarea:focus{border-color:var(--cyan);box-shadow:0 0 0 3px #67e8f915}#code-mode-panel .journey-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:14px}#code-mode-panel .journey-controls button{margin:0}#code-mode-panel .hint{margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}.code-flow{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 22px}.code-flow span{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#07101d;border:1px solid var(--line);border-radius:9px;color:var(--muted);font-size:.75rem;font-weight:700}.code-flow b{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#164e63;color:var(--cyan)}.code-editor-head{display:flex;align-items:end;justify-content:space-between;gap:14px;margin-top:22px}.code-editor-head label{margin:0}.code-editor-head small{display:block;color:var(--muted);font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:3px}.code-editor-head .code-import{margin:0;padding:8px 11px;border:1px solid var(--line);border-radius:8px;color:var(--cyan);cursor:pointer;font-size:.74rem}.code-editor-head .code-import:hover{border-color:var(--cyan)}.journey-setup-title{margin:26px 0 8px;font-size:1rem}.journey-setup{margin:12px 0 0;padding:13px 15px;border:1px solid var(--line);border-radius:9px;background:#07101d;overflow-x:auto}.journey-setup code{color:#a8d8ea;font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace}.journey-setup-list{margin:12px 0 0;padding-left:20px;color:var(--muted);font-size:.8rem;line-height:1.9}.journey-setup-list code{padding:2px 6px;border-radius:4px;background:#0f2537;color:#a8d8ea;font-size:.92em}
.journey-admin{margin-top:16px;padding:14px 16px;border:1px solid #2a4d66;border-radius:11px;background:#07101d}.journey-admin[hidden]{display:none}.journey-admin label{margin:0}#code-mode-panel .journey-admin .hint{margin:6px 0 0;padding:0;border:0}.journey-admin code{padding:1px 5px;border-radius:4px;background:#0f2537;font-size:.92em}.journey-admin-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:11px}.journey-admin-row button{flex:0 0 auto;margin:0}.journey-admin-row a{flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:9px;background:linear-gradient(135deg,#22d3ee,#3b82f6);color:#04121f;font-weight:600;text-decoration:none}.journey-admin-row a:hover{filter:brightness(1.08)}
.code-result{margin-top:18px;padding:16px;border:1px solid var(--line);border-radius:13px;background:#07101d}.code-result.pass{border-color:#2f9e6688;background:#0c241b}.code-result.fail{border-color:#c94b5b88;background:#291419}.code-result-head{display:flex;justify-content:space-between;align-items:start;gap:16px}.code-result-head span{font-weight:900;color:var(--green)}.code-result.fail .code-result-head span{color:var(--red)}.code-result-head small{display:block;color:var(--muted);font-size:.68rem;margin-top:4px}.code-result-head strong{font-size:1.2rem}.code-result-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.code-result-metrics span{padding:9px;background:#07101d88;border-radius:8px;color:var(--muted);font-size:.72rem}.code-result-metrics b{display:block;color:var(--text);font-size:1rem}.code-result pre{white-space:pre-wrap;overflow:auto;margin:14px 0 0;padding:12px;background:#07101d;border-radius:8px;color:var(--red);font-size:.75rem}@media(max-width:620px){.code-flow{grid-template-columns:1fr}#code-mode-panel textarea{min-height:330px}.code-result-metrics{grid-template-columns:1fr 1fr 1fr}}`;

// Cliente HTTP interativo da página /api-tests (estilo Postman) — sem
// relação com CODE_MODE_STYLES/#code-mode-panel, que continuam exclusivos
// da Jornada Playwright.
const API_TESTS_STYLES = `
.api-workspace{max-width:1120px;margin:0 auto}
#http-client-panel{max-width:none;margin:0;padding:0;overflow:hidden}
.http-request-line{display:grid;grid-template-columns:110px minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:20px;border-bottom:1px solid var(--line);background:#0b1727}
.http-request-line select,.http-request-line input,.http-request-line button{width:auto;margin:0}
.http-request-line input{min-width:0}
.http-request-line button{padding:12px 17px}
.http-clear{color:var(--muted)!important}
.http-send.cancel-active{background:#7f1d1d;color:var(--red);box-shadow:none}
#http-error,#http-notice{margin:14px 20px 0}
.http-notice{display:none;background:#064e3b55;border:1px solid #6ee7b755;color:var(--green);border-radius:10px;padding:11px 13px;font-size:.82rem}
.http-layout{display:grid;grid-template-columns:minmax(0,1.04fr) minmax(0,.96fr);min-height:470px}
.http-request{border-right:1px solid var(--line)}
.http-workspace-title{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px 12px}
.http-workspace-title h2{font-size:1rem;margin:0}
.http-workspace-title small{color:var(--muted);font-size:.7rem}
.http-tabs{display:flex;align-items:stretch;gap:4px;padding:0 20px;border-bottom:1px solid var(--line);overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
.http-tab{position:relative;display:flex;align-items:center;justify-content:center;flex:0 0 auto;min-height:44px;width:auto;margin:0;padding:10px 12px;border-radius:0;background:transparent;color:var(--muted);box-shadow:none;font-size:.78rem;white-space:nowrap}
.http-tab:hover{transform:none;color:var(--text)}
.http-tab.active{color:var(--cyan)}
.http-tab.active:after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:2px;background:var(--cyan);border-radius:2px}
.http-tab-count{display:inline-grid;place-items:center;min-width:19px;height:19px;margin-left:5px;padding:0 5px;border:1px solid var(--line);border-radius:999px;font-size:.65rem}
.http-tab-panel{padding:18px 20px}
.http-tab-panel[hidden]{display:none}
.http-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.http-section-head h3{margin:0;font-size:.78rem;color:#cbd8e9}
.http-section-head>div{display:flex;align-items:center;gap:8px}
.http-section-head button{margin:0;width:auto;flex:0 0 auto;padding:8px 11px;font-size:.74rem}
.http-section textarea{width:100%;min-height:245px;resize:vertical;background:#07101d;border:1px solid #344964;color:var(--text);border-radius:10px;padding:12px;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;outline:0}
.http-section textarea:focus{border-color:var(--cyan);box-shadow:0 0 0 3px #67e8f912}
.http-body-state{color:var(--yellow);font-size:.7rem}
.http-body-state[hidden]{display:none}
.http-auth-type{max-width:260px;margin:0 0 18px}
.http-auth-fields{display:grid;gap:12px}
.http-auth-fields[hidden]{display:none}
.http-auth-fields label{margin:0 0 6px}
.http-auth-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.http-auth-grid input,.http-auth-grid select,.http-auth-fields>div>input{margin:0}
.http-auth-note{margin:0;padding:12px;background:#07101d;border:1px solid var(--line);border-radius:9px;color:var(--muted);font-size:.75rem;line-height:1.5}
.http-kv-labels,.http-kv-row{display:grid;grid-template-columns:minmax(120px,.8fr) minmax(160px,1.2fr) 38px;gap:8px}
.http-kv-labels{padding:0 2px 6px;color:var(--muted);font-size:.67rem;text-transform:uppercase;letter-spacing:.06em}
.http-kv-row{margin-bottom:8px}
.http-kv-row input{margin:0;min-width:0;padding:10px 11px}
.http-kv-remove{width:38px!important;height:40px;margin:0!important;padding:0!important;font-weight:900;color:var(--muted)!important}
.http-response-shell{min-width:0;background:#081421}
.http-response-tools{display:flex;align-items:center;gap:8px}
.http-response-tools button{width:auto;margin:0;padding:8px 11px;font-size:.72rem}
.http-response-empty{min-height:380px;display:grid;place-items:center;padding:30px;text-align:center;color:var(--muted)}
.http-response-empty[hidden]{display:none}
.http-response-empty i{display:grid;place-items:center;width:58px;height:58px;margin:0 auto 14px;border:1px solid var(--line);border-radius:16px;background:#07101d;color:var(--cyan);font:700 1.15rem ui-monospace,SFMono-Regular,Consolas,monospace}
.http-response-empty strong{display:block;color:#cbd8e9;font-size:.9rem}
.http-response-empty span{display:block;max-width:250px;margin-top:6px;font-size:.75rem;line-height:1.5}
.http-response{padding-bottom:18px}
.http-response[hidden]{display:none}
.http-response-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:0 20px 15px}
.http-response-meta{color:var(--muted);font-size:.72rem}
.http-status{font-weight:900;padding:4px 10px;border-radius:999px;background:#07101d;border:1px solid var(--line);font-size:.76rem}
.http-status.ok{color:var(--green);border-color:#2f9e6688}
.http-status.redirect{color:var(--yellow);border-color:#a1782688}
.http-status.error{color:var(--red);border-color:#c94b5b88}
.http-response-panel{padding:15px 20px 0}
.http-response-panel[hidden]{display:none}
.http-response pre{white-space:pre-wrap;word-break:break-word;overflow:auto;margin:0;padding:14px;background:#050b14;border:1px solid var(--line);border-radius:9px;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;max-height:330px;min-height:245px}
.http-library{border-top:1px solid var(--line)}
.http-library>.http-tabs{background:#0b1727}
.http-library-panel{padding:20px}
.http-library-panel[hidden]{display:none}
.http-collection{padding:20px}
.http-collection-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
.http-collection-head h2{margin:0;font-size:1rem}
.http-collection-head p{margin:4px 0 0;color:var(--muted);font-size:.72rem}
.http-collection-save{display:flex;gap:8px;min-width:min(100%,390px)}
.http-collection-save input{margin:0;flex:1 1 auto;width:auto;min-width:0;padding:10px 11px}
.http-collection-save button{margin:0;flex:0 0 auto;width:auto;padding:10px 13px;font-size:.78rem}
.http-collection-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;flex-wrap:wrap}
.http-collection-search{max-width:320px;margin:0;padding:10px 11px}
.http-import-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.http-import-row button{width:auto;margin:0;padding:9px 11px;font-size:.74rem}
.http-import-label{margin:0;padding:9px 11px;border:1px solid var(--line);border-radius:8px;color:var(--cyan);cursor:pointer;font-size:.74rem;font-weight:700}
.http-import-label:hover{border-color:var(--cyan)}
.http-collection-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0 0}
.http-collection-list>.hint{grid-column:1/-1}
.http-collection-item{display:flex;align-items:center;gap:9px;padding:10px 11px;background:#07101d;border:1px solid var(--line);border-radius:10px}
.http-collection-item.active{border-color:#67e8f977;background:#0b2234}
.http-method-badge{flex:0 0 auto;min-width:48px;color:var(--green);font:800 .68rem ui-monospace,SFMono-Regular,Consolas,monospace}
.http-collection-load{flex:1 1 auto;width:auto;min-width:0;text-align:left;background:none;border:none;color:var(--text);cursor:pointer;padding:0;margin:0;box-shadow:none}
.http-collection-load:hover{transform:none}
.http-collection-load strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem}
.http-collection-load span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:.68rem;margin-top:3px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.http-collection-delete{margin:0!important;flex:0 0 auto;width:auto!important;padding:7px 9px!important;color:var(--muted)!important;font-size:.7rem!important}
.http-history-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.http-history-head h2{margin:0;font-size:1rem}
.http-history-head p{margin:4px 0 0;color:var(--muted);font-size:.72rem}
.http-history-head button{width:auto;margin:0;padding:9px 11px;font-size:.74rem}
.http-history-list{display:grid;gap:8px;margin-top:14px}
.http-history-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px 12px;background:#07101d;border:1px solid var(--line);border-radius:10px}
.http-history-load{width:auto;min-width:0;margin:0;padding:0;text-align:left;background:transparent;box-shadow:none;color:var(--text)}
.http-history-load:hover{transform:none}
.http-history-load strong,.http-history-load span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.http-history-load strong{font-size:.78rem}
.http-history-load span{margin-top:3px;color:var(--muted);font:10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}
.http-history-result{text-align:right}
.http-history-result strong{display:block;color:var(--green);font-size:.75rem}
.http-history-result strong.error{color:var(--red)}
.http-history-result small{display:block;margin-top:3px;color:var(--muted);font-size:.65rem}
.http-footnote{margin:0;padding:0 20px 20px}
@media(max-width:820px){
  .http-layout{grid-template-columns:1fr}
  .http-request{border-right:0;border-bottom:1px solid var(--line)}
  .http-response-empty{min-height:250px}
}
@media(max-width:620px){
  .http-request-line{grid-template-columns:92px minmax(0,1fr)}
  .http-request-line button{width:100%}
  .http-collection-head{display:block}
  .http-collection-save{margin-top:12px;min-width:0}
  .http-collection-list{grid-template-columns:1fr}
  .http-auth-grid{grid-template-columns:1fr}
}
@media(max-width:430px){
  .http-request-line{grid-template-columns:1fr}
  .http-request .http-workspace-title small{display:none}
  .http-kv-labels{display:none}
  .http-kv-row{grid-template-columns:1fr 38px}
  .http-kv-row .http-kv-value{grid-column:1/2}
  .http-kv-row .http-kv-remove{grid-column:2;grid-row:1/3;height:100%}
  .http-tabs{padding:0 10px}
  .http-tab-panel,.http-response-panel{padding-left:14px;padding-right:14px}
  .http-collection-save{display:grid}
}`;

const FAQ_STYLES = `
.docs-panel{max-width:860px;margin:0 auto}
.docs-panel h1{margin-top:8px}
.docs-panel .lead{margin-bottom:6px}
.docs-panel h2.faq-group{margin:34px 0 12px;padding-bottom:9px;border-bottom:1px solid var(--line);color:#88a0b6;font-size:.68rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.faq-item{border-bottom:1px solid var(--line)}
.faq-item summary{position:relative;padding:16px 42px 16px 0;color:#dbe8f6;font-size:.94rem;font-weight:650;line-height:1.45;cursor:pointer;list-style:none;transition:color .18s}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item summary:hover{color:var(--cyan)}
.faq-item summary:focus-visible{outline:2px solid var(--cyan);outline-offset:3px;border-radius:3px}
.faq-item summary:after{content:"";position:absolute;right:8px;top:50%;width:8px;height:8px;margin-top:-6px;border-right:1.5px solid #7d95ab;border-bottom:1.5px solid #7d95ab;transform:rotate(45deg);transition:transform .2s,border-color .18s}
.faq-item[open] summary{color:var(--cyan)}
.faq-item[open] summary:after{margin-top:-2px;transform:rotate(-135deg);border-color:var(--cyan)}
.faq-answer{padding:0 44px 20px 0;color:#9db0c2;font-size:.86rem;line-height:1.65}
.faq-answer p{margin:0 0 11px}
.faq-answer p:last-child{margin-bottom:0}
.faq-answer strong{color:#cfdeee}
.faq-answer ul{margin:0;padding-left:19px}
.faq-answer li{margin-bottom:7px}
.faq-answer li:last-child{margin-bottom:0}
.faq-answer code{padding:1px 5px;border-radius:3px;background:#07101d;color:var(--cyan);font-size:.82em}
.docs-action{margin:15px 0 2px;padding:13px 15px;border:1px solid var(--line);border-radius:9px;background:#07101d}
.docs-action a{display:block;color:var(--cyan);font-weight:800;text-decoration:none}
.docs-action a:hover{text-decoration:underline}
.docs-action span{display:block;margin-top:5px;color:var(--muted);font-size:.78rem}
@media(max-width:560px){.faq-item summary{padding-right:32px;font-size:.86rem}.faq-answer{padding-right:0;font-size:.82rem}}`;

// Uma pergunta alcançada por âncora (ex.: /docs#alertas, vindo da navegação lateral)
// precisa chegar aberta — <details> não expande sozinho com :target.
const DOCS_FAQ_SCRIPT = String.raw`
function openFaqFromHash(){
  const id=location.hash.slice(1);
  if(!id)return;
  const item=document.getElementById(id);
  if(!item||item.tagName!=='DETAILS')return;
  item.open=true;
  item.scrollIntoView({block:'center'});
}
openFaqFromHash();
window.addEventListener('hashchange',openFaqFromHash);
`;

/**
 * Estilo do QA Toolbox.
 *
 * Reaproveita as variáveis, o painel e os botões do produto: o Toolbox é uma
 * área nova, não um produto novo, e uma paleta própria só faria a pessoa sentir
 * que saiu do QA Radar. O que existe aqui são as formas que as outras páginas
 * ainda não tinham — catálogo em cards, tabela de casos e bloco de código.
 */
const TOOLBOX_STYLES = `
.toolbox-layout{max-width:var(--page-max);margin:0 auto}
.toolbox-search{margin-bottom:28px}
.toolbox-search label{margin-top:0}
.toolbox-search input{max-width:520px}
.toolbox-search .hint{margin-top:8px}
.tool-category+.tool-category{margin-top:34px}
.tool-category[hidden]{display:none}
.tool-category-head h2{margin:0;font-size:.72rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:#88a0b6}
.tool-category-head p{margin:5px 0 14px;color:var(--muted);font-size:.82rem}
.tool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:12px}
.tool-card{display:flex;flex-direction:column;gap:12px;padding:16px 17px;border:1px solid var(--line);border-radius:12px;background:#0a1826;color:var(--text);text-decoration:none;transition:border-color .18s,transform .18s,background .18s}
.tool-card[hidden]{display:none}
.tool-card:hover{border-color:#2a6d86;background:#0c1e2f;transform:translateY(-2px)}
.tool-card:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
.tool-card[data-tool-soon]{opacity:.55;cursor:default}
.tool-card[data-tool-soon]:hover{transform:none;border-color:var(--line);background:#0a1826}
.tool-card-icon{display:grid;place-items:center;width:34px;height:34px;border:1px solid #1d3f56;border-radius:9px;background:#0d2436;color:var(--cyan)}
.tool-card-icon .tool-icon{position:relative;display:block;width:22px;height:22px}
.tool-card-body strong{display:flex;align-items:center;gap:8px;font-size:.95rem;color:#e9f3ff}
.tool-card-body small{display:block;margin-top:5px;color:var(--muted);font-size:.79rem;line-height:1.5}
.tool-card-status{padding:2px 7px;border-radius:999px;font-size:.6rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.tool-card-status-beta{border:1px solid #6b5619;background:#201a06;color:#f0dca4}
.tool-card-status-new{border:1px solid #1f5d4f;background:#0c2620;color:#a9e8d5}
.tool-card-status-soon{border:1px solid var(--line);background:#0d1b28;color:var(--muted)}
.tool-card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:11px;border-top:1px solid #16293c}
.tool-card-action{color:var(--cyan);font-size:.76rem;font-weight:800}
.tool-card[data-tool-soon] .tool-card-action{color:var(--muted)}
.tool-privacy{padding:3px 9px;border-radius:999px;font-size:.63rem;font-weight:700;letter-spacing:.03em}
.tool-privacy-local:before{content:"\\1F512";margin-right:5px}
.tool-privacy-local{border:1px solid #1f5d4f;background:#0c2620;color:#a9e8d5}
.tool-privacy-server{border:1px solid #2a4d66;background:#0f2537;color:#9dc6dd}
.toolbox-empty{margin:26px 0 0;padding:18px;border:1px dashed var(--line);border-radius:11px;color:var(--muted);font-size:.85rem;text-align:center}
.toolbox-empty code{padding:2px 6px;border-radius:4px;background:#07101d;color:var(--cyan)}
/* justify-content explícito: o seletor \`nav\` do tema espalha os filhos com space-between. */
.tool-breadcrumb{display:flex;align-items:center;justify-content:flex-start;gap:8px;max-width:var(--page-max);margin:0 auto 14px;color:var(--muted);font-size:.76rem}
.tool-breadcrumb a{color:var(--cyan);text-decoration:none}
.tool-breadcrumb a:hover{text-decoration:underline}
.tool-header-badges{display:flex;gap:8px;margin-top:12px}
.tool-panel{max-width:var(--page-max);margin:0 auto 18px}
.tool-panel textarea{display:block;width:100%;min-height:150px;padding:13px;border:1px solid #344964;border-radius:10px;background:#07101d;color:#d8e8f8;font:12.5px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;outline:0;resize:vertical;tab-size:2}
.tool-panel textarea:focus{border-color:var(--cyan);box-shadow:0 0 0 3px #67e8f915}
.tool-io{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.tool-field label{margin-top:0}
.tool-grid-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:16px}
.tool-grid-fields .tool-field[hidden]{display:none}
.tool-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}
.tool-actions button{width:auto;margin:0;padding:11px 18px;font-size:.83rem}
.tool-actions-inline{align-items:center;gap:12px}
.tool-actions-inline .hint{margin:0}
.tool-note{margin:16px 0 0;padding-top:13px;border-top:1px solid var(--line);color:var(--muted);font-size:.76rem;line-height:1.6}
.tool-note-server{margin:0 0 18px;padding:12px 14px;border:1px solid #2a4d66;border-top:1px solid #2a4d66;border-radius:9px;background:#0c1d2c;color:#a8c4d8}
.tool-warning{margin:0 0 18px;padding:12px 14px;border:1px solid #6b5619;border-radius:9px;background:#201a06;color:#f0dca4;font-size:.79rem;line-height:1.55}
.tool-warning-list{padding:12px 14px 12px 32px}.tool-warning-list li+li{margin-top:6px}.tool-warning-list[hidden]{display:none}
.tool-result-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px}
.tool-result-head h2{margin:0;font-size:1.1rem}
.tool-result-actions{display:flex;gap:8px;flex-wrap:wrap}
.tool-result-actions button{width:auto;margin:0;padding:8px 13px;font-size:.75rem}
.tool-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.tool-summary-text{color:var(--muted);font-size:.79rem}
.tool-status{display:inline-flex;align-items:center;padding:5px 11px;border-radius:999px;font-size:.68rem;font-weight:800;letter-spacing:.05em}
.tool-status-ok{border:1px solid #1f5d4f;background:#0c2620;color:#a9e8d5}
.tool-status-warning{border:1px solid #6b5619;background:#201a06;color:#f0dca4}
.tool-status-fail{border:1px solid #6d2634;background:#2a1119;color:#ffc7d1}
.tool-status-row{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:12px}
.tool-subtitle{margin:20px 0 8px;font-size:.72rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#88a0b6}
.tool-code{margin:0;padding:15px;border:1px solid var(--line);border-radius:10px;background:#07101d;color:#a8d8ea;font:12.5px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-x:auto;white-space:pre;max-height:460px}
.tool-code:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
.tool-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;padding:5px;border-radius:10px;background:#07101d}
.tool-tab{width:auto;margin:0;padding:8px 13px;border:0;border-radius:7px;background:transparent;color:var(--muted);font-size:.77rem;font-weight:700;box-shadow:none}
.tool-tab:hover{transform:none;color:var(--text)}
.tool-tab.active{background:var(--panel2);color:var(--cyan)}
.tool-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin:0 0 18px}
.tool-facts div{padding:11px 13px;border:1px solid var(--line);border-radius:9px;background:#07101d}
.tool-facts dt{color:var(--muted);font-size:.68rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.tool-facts dd{margin:5px 0 0;color:#dbe8f6;font-size:.82rem;word-break:break-word}
.tool-secret{color:#f0dca4;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.tool-table{width:100%;border-collapse:collapse;font-size:.82rem}
.tool-table th,.tool-table td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.tool-table thead th{color:var(--muted);font-size:.66rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.tool-table tbody th{color:var(--cyan);font-weight:800;white-space:nowrap}
.tool-table code{color:#a8d8ea;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.tool-table-fields input,.tool-table-fields select{padding:8px 10px;font-size:.8rem}
.tool-hint-cell{color:var(--muted);font-size:.75rem}
.tool-check{display:flex;align-items:center;gap:9px;margin:0;font-weight:650;color:#dbe8f6;cursor:pointer}
.tool-check input{width:16px;height:16px;flex:0 0 16px;padding:0;accent-color:#22d3ee}
.tool-diff-list{display:grid;gap:9px}
.diff-entry{display:grid;grid-template-columns:118px minmax(0,1fr);gap:12px;padding:13px 14px;border:1px solid var(--line);border-left-width:3px;border-radius:9px;background:#07101d}
.diff-added{border-left-color:#2fd3b0}
.diff-removed{border-left-color:#f0708a}
.diff-changed{border-left-color:#f4ae38}
.diff-type_changed{border-left-color:#a78bfa}
.diff-kind{align-self:start;padding:4px 8px;border-radius:5px;background:#0f2537;color:#9dc6dd;font-size:.6rem;font-weight:800;letter-spacing:.05em;text-align:center}
.diff-path{display:block;color:var(--cyan);font:12.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}
.diff-values{display:grid;gap:3px;margin-top:8px;font:12.5px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}
.diff-before{color:#f0a4b1}
.diff-after{color:#a9e8d5}
.diff-arrow{color:var(--muted)}
.diff-types{display:block;margin-top:7px;color:var(--muted);font-size:.7rem}
.boundary-valid th{color:#a9e8d5}
.boundary-invalid th{color:#f0a4b1}
.health-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) 130px 40px;gap:10px;align-items:end;margin-bottom:11px}
.health-row .health-remove{width:40px;margin:0;padding:11px 0;font-size:1rem;line-height:1}
.health-reason{display:block;margin-top:5px;color:var(--muted);font-size:.7rem}
.tool-card-slot{position:relative;display:flex}
.tool-card-slot[hidden]{display:none}
.tool-card-slot>.tool-card{flex:1}
.tool-favorite{position:absolute;top:11px;right:11px;width:30px;height:30px;margin:0;padding:0;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--muted);box-shadow:none;font-size:.95rem;line-height:1;opacity:0;transition:opacity .18s,color .18s,border-color .18s}
.tool-card-slot:hover .tool-favorite,.tool-favorite:focus-visible,.tool-favorite.active{opacity:1}
.tool-favorite:hover{transform:none;border-color:#2a4d66;color:#f4ae38}
.tool-favorite:focus-visible{outline:2px solid var(--cyan);outline-offset:1px}
.tool-favorite.active{color:#f4ae38}
.tool-category-favorites .tool-category-head h2{color:#f4ae38}
.pairwise-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) 40px;gap:10px;align-items:end;margin-bottom:11px}
.pairwise-row .pairwise-remove{width:40px;margin:0;padding:11px 0;font-size:1rem;line-height:1}
.tool-note-plain{margin:0 0 18px;padding:0;border:0}
.tool-table-scroll{overflow-x:auto}
.regex-line{display:grid;grid-template-columns:minmax(0,1fr) 130px;gap:12px}
.regex-lines{display:grid;gap:3px;margin-bottom:6px;max-height:260px;overflow:auto}
.regex-line-row{display:grid;grid-template-columns:44px minmax(0,1fr);gap:10px;padding:5px 9px;border-radius:6px;background:#07101d;font:12.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
.regex-line-row code{color:#8fa6bb;word-break:break-all}
.regex-line-row.matched{background:#0c2620;border-left:2px solid #2fd3b0}
.regex-line-row.matched code{color:#a9e8d5}
.regex-line-number{color:var(--muted);text-align:right}
.status-list{display:grid;gap:10px}
.status-item{padding:13px 15px;border:1px solid var(--line);border-left-width:3px;border-radius:10px;background:#07101d}
.status-item header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.status-item header b{color:var(--cyan);font:800 1.05rem/1 ui-monospace,SFMono-Regular,Consolas,monospace}
.status-item header strong{color:#e9f3ff;font-size:.92rem}
.status-item header span{margin-left:auto;color:var(--muted);font-size:.68rem;letter-spacing:.06em;text-transform:uppercase}
.status-item p{margin:8px 0 0;color:var(--muted);font-size:.82rem;line-height:1.6}
.status-testing b{color:#cfdeee}
.schema-pointer{display:block;margin-top:4px;color:var(--muted);font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}
.webhook-url-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:center}
.webhook-url-row input{font:12.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--cyan)}
.webhook-url-row button{width:auto;margin:0;padding:12px 16px}
.webhook-list{display:grid;gap:9px}
.webhook-item{border:1px solid var(--line);border-radius:10px;background:#07101d;overflow:hidden}
.webhook-item>summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;cursor:pointer;list-style:none;font-size:.82rem}
.webhook-item>summary::-webkit-details-marker{display:none}
.webhook-item>summary:hover{background:#0b1b29}
.webhook-item>summary:focus-visible{outline:2px solid var(--cyan);outline-offset:-2px}
.webhook-item>summary b{padding:3px 9px;border:1px solid #2a4d66;border-radius:5px;background:#0f2537;color:var(--cyan);font-size:.7rem;letter-spacing:.05em}
.webhook-item>summary code{color:#dbe8f6;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.webhook-item>summary span{margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums}
.webhook-item>summary em{color:var(--muted);font-size:.72rem;font-style:normal}
.webhook-item>*:not(summary){margin-left:14px;margin-right:14px}
.webhook-item>*:last-child{margin-bottom:14px}
/* Corpo de webhook não é código: quebrar linha evita a linha de 64 mil caracteres que congelava a aba. */
.webhook-body{white-space:pre-wrap;word-break:break-all;max-height:340px}
#webhook-auto.active{border-color:#1f5d4f;color:#a9e8d5}
.status-1xx{border-left-color:#8ba0b3}.status-2xx{border-left-color:#2fd3b0}.status-3xx{border-left-color:#60a5fa}.status-4xx{border-left-color:#f4ae38}.status-5xx{border-left-color:#f0708a}
@media(max-width:900px){
  .tool-io{grid-template-columns:1fr}
  .pairwise-row{grid-template-columns:minmax(0,1fr) 40px;grid-template-areas:"nome nome" "valores remover"}
  .pairwise-row .tool-field:nth-child(1){grid-area:nome}
  .pairwise-row .tool-field:nth-child(2){grid-area:valores}
  .pairwise-row .pairwise-remove{grid-area:remover}
  .regex-line{grid-template-columns:1fr}
  .tool-favorite{opacity:1}
  .health-row{grid-template-columns:minmax(0,1fr) 110px;grid-template-areas:"name name" "url url" "method remove"}
  .health-row .tool-field:nth-child(1){grid-area:name}
  .health-row .tool-field:nth-child(2){grid-area:url}
  .health-row .tool-field:nth-child(3){grid-area:method}
  .health-row .health-remove{grid-area:remove;width:100%}
}
@media(max-width:640px){
  .tool-grid{grid-template-columns:1fr}
  .diff-entry{grid-template-columns:1fr}
  .diff-kind{width:max-content}
  .tool-actions button,.tool-result-actions button{width:100%}
  .tool-table{display:block;overflow-x:auto}
}`;

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function createWebPage(turnstileSiteKey?: string, allowHistory = false, maxSitemapPages = 20): string {
  const turnstileScript = turnstileSiteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : "";
  const turnstileWidget = turnstileSiteKey
    ? `<div id="turnstile-block"><div class="cf-turnstile" data-sitekey="${escapeAttribute(turnstileSiteKey)}" data-theme="dark" data-size="flexible" data-callback="onTurnstileSuccess" data-expired-callback="onTurnstileExpired" data-error-callback="onTurnstileError"></div><small class="hint">Verificação de segurança necessária para iniciar a análise.</small></div>`
    : "";
  const historyWidget = allowHistory
    ? '<button class="secondary" id="history-button" type="button">Consultar histórico</button><section class="history-panel" id="history-panel" hidden><div class="history-head"><div><strong>Histórico do projeto</strong><small id="history-baseline">Nenhum baseline aprovado</small></div><span id="history-count"></span></div><div class="history-list" id="history-list"></div></section>'
    : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="QA Radar - scanner de qualidade para aplicações web">
  <title>QA Radar · Web Scanner</title>
  ${turnstileScript}
  <style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}</style>
</head>
<body>${renderDashboard({ allowHistory, maxSitemapPages, turnstileWidget, historyWidget })}
<script>${SHELL_CLIENT_SCRIPT}</script><script>${WEB_CLIENT_SCRIPT}</script></body></html>`;
}

export function createHomePage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="QA Radar - qualidade e diagnóstico para aplicações web">
  <title>QA Radar · Qualidade web</title>
  <style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}</style>
</head>
<body>${renderHome()}<script>${SHELL_CLIENT_SCRIPT}</script><script>${HOME_DASHBOARD_SCRIPT}</script></body>
</html>`;
}

export function createApplicationsPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="QA Radar - aplicações da sua conta"><title>QA Radar · Aplicações</title><style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}${APPLICATIONS_STYLES}</style></head>
<body>${renderApplicationsPage()}<script>${SHELL_CLIENT_SCRIPT}</script><script>${APPLICATIONS_CLIENT_SCRIPT}</script></body>
</html>`;
}

export function createAuthPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Entrar ou criar conta no QA Radar"><meta name="robots" content="noindex"><title>QA Radar · Entrar</title><style>${WEB_STYLES}${AUTH_STYLES}</style></head>
<body>${renderAuthPage()}<script>${AUTH_CLIENT_SCRIPT}</script></body>
</html>`;
}

export function createConstructionPage(area: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="QA Radar - área em construção"><title>QA Radar · Em construção</title><style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}</style></head>
<body>${renderConstructionPage(area)}<script>${SHELL_CLIENT_SCRIPT}</script></body>
</html>`;
}

export function createDocsPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Perguntas frequentes sobre o QA Radar"><title>QA Radar · Ajuda</title><style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}${FAQ_STYLES}</style></head>
<body>${renderDocs()}<script>${SHELL_CLIENT_SCRIPT}</script><script>${DOCS_FAQ_SCRIPT}</script></body>
</html>`;
}

export function createJourneyPage(allowCodeMode = false): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="QA Radar - Modo Jornada de Playwright"><title>QA Radar · Jornada Playwright</title><style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}${CODE_MODE_STYLES}</style></head>
<body>${renderJourneyPage(allowCodeMode)}<script>${SHELL_CLIENT_SCRIPT}</script><script>${WEB_CLIENT_SCRIPT}</script></body></html>`;
}

export function createApiTestsPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="QA Radar - Testes de API"><title>QA Radar · Testes de API</title><style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}${API_TESTS_STYLES}</style></head>
<body>${renderApiPage()}<script>${SHELL_CLIENT_SCRIPT}</script><script>${WEB_CLIENT_SCRIPT}</script></body></html>`;
}

export function createToolboxHomePage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="QA Toolbox - ferramentas rápidas para QA, automação, APIs e design de testes"><title>QA Radar · QA Toolbox</title><style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}${TOOLBOX_STYLES}</style></head>
<body>${renderToolboxHome()}<script>${SHELL_CLIENT_SCRIPT}</script><script type="module">${TOOLBOX_HOME_SCRIPT}</script></body>
</html>`;
}

/**
 * Página de uma ferramenta.
 *
 * Devolve `undefined` quando a ferramenta ainda não tem painel — é o caso das
 * anunciadas como "em breve", e a rota traduz isso em 404 em vez de servir uma
 * casca vazia.
 */
export function createToolPage(tool: QaToolDefinition): string | undefined {
  const body = renderTool(tool);
  const script = TOOLBOX_SCRIPTS[tool.id];
  if (body === undefined || script === undefined) return undefined;
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeAttribute(`QA Toolbox - ${tool.description}`)}"><title>QA Radar · ${escapeAttribute(tool.name)}</title><style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}${TOOLBOX_STYLES}</style></head>
<body>${body}<script>${SHELL_CLIENT_SCRIPT}</script><script type="module">${script}</script></body>
</html>`;
}
