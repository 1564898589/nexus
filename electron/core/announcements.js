'use strict';
/**
 * NEXUS OFFICIAL ANNOUNCEMENTS — local-first (no cloud dependency).
 * 开发者：竖 · 邮箱 1564898589@qq.com. Announcements + read state live in userData.
 * Boot popup rules: first run / unread important / new version. No meaningless repeats.
 */
const fs = require('fs');
const path = require('path');

const TYPES = ['产品更新', '版本更新', '新功能上线', '功能优化', '数据源调整', '系统维护', '兼容性说明', '已知问题', '重要通知'];

// Seed announcements reflect REAL delivered changes (no fabricated features).
function seedAnnouncements(version) {
  return [
    {
      id: 'v1.0.0', type: '版本更新', version: '1.0.0', important: true, requireAck: true,
      title: 'NEXUS V1.0 正式发布 —— 国服智能战术指挥系统',
      createdAt: '2026-11-19T00:00:00+08:00',
      body: 'NEXUS 从英雄数据工具升级为国服智能电竞情报与战术指挥系统。本次版本聚焦真实国服战绩、双方十人侦察与对局情报，全部基于本地只读接口与真实数据，绝不伪造。',
      added: [
        '国服玩家战绩查询中心：召唤师搜索、资料卡、历史战绩（10/20/50 场）、数据统计。',
        'LCU + SGP 双通道战绩引擎：LCU 首页与单局详情，SGP 深分页（entitlements 凭据，内存持有）。',
        '双方十人实力评级（S/A/B/C/D）：长期实力与近期状态分离，绝活英雄识别，样本量与可信度标注。',
        '对局情报室（War Room）：BP 十人侦察、PRE-MATCH SCOUTING REPORT（事实/推断/建议三标记）。',
        '对局中快速玩家情报卡：一键查看任意玩家，重点关注/威胁标记，本地缓存。',
        '实时教练：按客户端阶段给出符文/技能/对位建议；对局内实时遥测因合规边界（不读内存/不截屏）明确标注不可用。',
        '赛后复盘：基于本地缓存真实对局逐场分析，与个人基准对比，事实/推断/建议分离，可选 AI 解读。',
        '个人成长：近期 vs 此前趋势、胜负/KDA 走势、英雄池演变，样本不足时诚实提示。',
        '版本趋势（Meta Watch）：真实 OP.GG 韩服版本生态与强度分布；多版本数据随更新自然积累。',
        '情报提醒：标记玩家入敌方、敌方绝活、我的绝活被禁自动提醒，可在设置中逐项开关。',
        'NEXUS LIVE 悬浮窗：置顶/拖动/透明度/位置记忆，F9 快捷键开关，轻量十人评级。',
        'AI 多模型中心（OpenAI 兼容）：服务商管理、连接测试、模型路由、调用日志，密钥安全存储。',
        '官方公告中心（开发者：竖）。',
      ],
      improved: [
        'LCU 引擎改为严格只读：移除符文写入，仅分析与推荐，符合安全合规边界。',
        '客户端发现增强：解析 rso_platform_id / region / 腾讯边缘主机，精准识别国服大区。',
        '数据中枢新增玩家/战绩/收藏/重点关注表与备份覆盖。',
        '多账号支持：最近查询/收藏玩家列表，可设「自己」账号，复盘/成长/教练默认分析该账号。',
        '导航升级为混合分组：指挥中心 / 战术中心 / 国服情报 / 个人 / 系统。',
      ],
      fixed: ['英雄卡片悬浮报错', 'CSP 内联事件拦截', '召唤师技能图标缺失', '符文 stat shard 图标加载', '复盘每分钟数据计算（时长与个人数据对象分离导致的空值）'],
      known: [
        '国服 LCU/SGP 实机战绩返回需在你登录的腾讯客户端上验证；未连接时如实显示不可用，不显示伪造数据。',
        '国服各大区 SGP 精确主机名内置候选映射，可在设置中覆盖；以实测为准。',
        '加点顺序部分 OP.GG 页面为客户端渲染，缺失时诚实留空。',
        '版本趋势当前仅含 16.23.1 单版本；跨版本对比需数据积累，界面已如实说明。',
      ],
      producer: '竖', team: null,
    },
    {
      id: 'guofu-readonly', type: '兼容性说明', version: '1.0.0', important: true, requireAck: false,
      title: '国服连接与只读模式说明',
      createdAt: '2026-11-19T00:00:00+08:00',
      body: 'NEXUS 通过本机英雄联盟客户端暴露的本地接口（LCU/SGP）只读获取数据。请先启动并登录国服客户端，NEXUS 会自动连接。严格不读内存、不注入、不改文件、不绕反作弊、不自动操作游戏。',
      added: [], improved: [], fixed: [],
      known: ['同类开源工具官方 README 不支持腾讯运营区，NEXUS 独立实现并验证国服适配，不直接套用其方案。'],
      producer: '竖', team: null,
    },
    {
      id: 'data-sources', type: '数据源调整', version: '1.0.0', important: false, requireAck: false,
      title: '数据来源与真实性承诺',
      createdAt: '2026-11-18T00:00:00+08:00',
      body: '英雄统计来自 OP.GG 韩服公开页面（标明来源/版本/段位/样本/时间），静态资料来自 Riot Data Dragon，玩家战绩来自你连接的国服客户端。启发式分析与真实统计始终分开标注。OP.GG 解析属非官方用途，仅供个人学习研究。',
      added: [], improved: [], fixed: [], known: ['OP.GG 服务条款页面未能取得，可能与其 ToS 冲突；来源失效时保留旧数据并提供官方跳转。'],
      producer: '竖', team: null,
    },
  ];
}

function createAnnouncements(dir, logger, version) {
  const log = logger ? logger.child('announcements') : { info() {}, error() {} };
  const file = path.join(dir, 'announcements.json');
  let data = { announcements: [], read: {}, acked: {}, lastSeenVersion: null, dismissNormal: false };
  try { if (fs.existsSync(file)) data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  if (!data.announcements || !data.announcements.length) { data.announcements = seedAnnouncements(version); save(); }
  // Merge release-generated announcement shipped with each build (real changes only).
  try {
    const relFile = path.join(__dirname, '..', '..', 'data', 'seed', 'release-ann.json');
    if (fs.existsSync(relFile)) {
      const rel = JSON.parse(fs.readFileSync(relFile, 'utf8'));
      const arr = Array.isArray(rel) ? rel : [rel];
      let changed = false;
      for (const a of arr) {
        if (!a || !a.id) continue;
        const i = data.announcements.findIndex(x => x.id === a.id);
        if (i < 0) { data.announcements.push(a); changed = true; }
        else if ((a.version || '') > (data.announcements[i].version || '')) { data.announcements[i] = a; changed = true; }
      }
      if (changed) save();
    }
  } catch (e) { log.warn('release-ann merge', e.message); }

  // 开发者信息统一迁移：历史版本存过的 Sail/制作人 字样一律改为「开发者：竖」；
  // 并清理历史公告中残留的对标/超越 Akari 字样（用户要求不出现）。
  {
    const before = JSON.stringify(data.announcements);
    const fixStr = (s) => typeof s === 'string' ? s
      .replace(/制作人[：:\s]*Sail/g, '开发者：竖').replace(/\bSail\b/g, '竖')
      .replace(/对标\s*(并超越\s*)?Akari\s*[：:]?/gi, '')
      .replace(/超越\s*Akari需在线/gi, '本地缓存回退')
      .replace(/超越\s*Akari/gi, '')
      .replace(/LeagueAkari/gi, '同类开源工具')
      .replace(/Akari/gi, '同类工具') : s;
    for (const a of data.announcements) {
      a.producer = '竖'; a.team = null;
      a.title = fixStr(a.title); a.body = fixStr(a.body);
      for (const k of ['added', 'improved', 'fixed', 'known']) if (Array.isArray(a[k])) a[k] = a[k].map(fixStr);
    }
    // 日期校正：历史占位/超前时间戳改为与版本顺序一致的单调时间。
    // 最新版本保留其真实发布时间，其余按版本序每档往前推 6h，保证日期随版本递增且均在 past。
    const verAnn = data.announcements.filter(a => /^\d+\.\d+\.\d+$/.test(a.version || ''));
    if (verAnn.length) {
      const uniq = [...new Set(verAnn.map(a => a.version))].sort((x, y) => {
        const px = x.split('.').map(Number), py = y.split('.').map(Number);
        for (let i = 0; i < 3; i++) if (px[i] !== py[i]) return py[i] - px[i];
        return 0;
      });
      const newest = verAnn.find(a => a.version === uniq[0]);
      const base = newest && newest.createdAt && isFinite(Date.parse(newest.createdAt)) ? Date.parse(newest.createdAt) : Date.now();
      const STEP = 6 * 3600 * 1000;
      const rank = {}; uniq.forEach((v, i) => { rank[v] = i; });
      for (const a of verAnn) {
        const iso = new Date(base - (rank[a.version] || 0) * STEP).toISOString();
        if (a.createdAt !== iso) a.createdAt = iso;
      }
    }
    if (JSON.stringify(data.announcements) !== before) save();
  }

  function save() { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); }
  // 按语义化版本降序（新版本在前）；createdAt 含历史占位时间戳/时区混用，不可作排序依据
  const cmpVer = (a, b) => {
    const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0); }
    return (b || '').localeCompare(a || '');
  };
  function list() { return data.announcements.map(a => ({ ...a, read: !!data.read[a.id], acked: !!data.acked[a.id] })).sort((a, b) => cmpVer(a.version, b.version) || (b.createdAt || '').localeCompare(a.createdAt || '')); }
  function get(id) { const a = data.announcements.find(x => x.id === id); return a ? { ...a, read: !!data.read[id], acked: !!data.acked[id] } : null; }
  function markRead(id) { data.read[id] = new Date().toISOString(); save(); }
  function ack(id) { data.acked[id] = new Date().toISOString(); data.read[id] = data.read[id] || new Date().toISOString(); save(); }
  function markAllRead() { for (const a of data.announcements) data.read[a.id] = new Date().toISOString(); save(); }
  function setDismissNormal(v) { data.dismissNormal = !!v; save(); }
  function add(a) { data.announcements.push(a); save(); }
  function importFile(json) {
    const arr = Array.isArray(json) ? json : (json.announcements || []);
    let n = 0;
    for (const a of arr) { if (!a.id || !a.title) continue; const i = data.announcements.findIndex(x => x.id === a.id); if (i >= 0) data.announcements[i] = a; else data.announcements.push(a); n++; }
    save(); return n;
  }
  // Boot popup decision
  function bootPopup() {
    const firstRun = !data.lastSeenVersion;
    const newVersion = data.lastSeenVersion !== version;
    const unreadImportant = data.announcements.filter(a => a.important && !data.read[a.id]);
    const unackedRequired = data.announcements.filter(a => a.requireAck && !data.acked[a.id]);
    let show = null;
    if (unackedRequired.length) show = unackedRequired[0];
    else if (firstRun || newVersion) show = data.announcements.find(a => a.version === version && a.important) || data.announcements[0];
    else if (unreadImportant.length && !data.dismissNormal) show = unreadImportant[0];
    data.lastSeenVersion = version; save();
    return show ? { ...show, read: !!data.read[show.id], acked: !!data.acked[show.id] } : null;
  }
  function unreadCount() { return data.announcements.filter(a => !data.read[a.id]).length; }
  return { list, get, markRead, ack, markAllRead, setDismissNormal, add, importFile, bootPopup, unreadCount, TYPES, file };
}

module.exports = { createAnnouncements, TYPES, seedAnnouncements };