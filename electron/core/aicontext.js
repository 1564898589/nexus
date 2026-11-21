'use strict';
/**
 * AI long-term memory / context assembler (P1-8).
 * Builds a bounded, source-tagged context block from REAL cached data + prior report
 * conclusions + training progress + pool tags + curated KB, so successive AI reports
 * have continuity (no repeated identical advice, references progress vs last report).
 * Never fabricates: every line traces to db/config; missing data is omitted or labeled.
 */
const MAX_CHARS = 2400;

function createAiContext({ db, config, players, queries, kb }) {
  const champName = (id) => { const c = db.get('SELECT nameCn,name FROM champions WHERE id=?', [id]); return c ? (c.nameCn || c.name) : ('#' + id); };
  const pct = (v) => (v == null ? '—' : (v * 100).toFixed(0) + '%');

  function selfPu() { return config.get('selfPuuid') || config.get('intelPuuid') || null; }

  function poolTags(pu) {
    return db.all('SELECT championId,proficiency,role FROM player_pool WHERE puuid=?', [pu]);
  }

  // prior report conclusions for continuity (same subject first, then same task global)
  function memory(subject, task) {
    const rows = db.all('SELECT task,subject,title,report,createdAt FROM ai_reports WHERE subject=? ORDER BY id DESC LIMIT 3', [String(subject || 'global')]);
    let use = rows;
    if (!use.length) use = db.all('SELECT task,subject,title,report,createdAt FROM ai_reports WHERE task=? ORDER BY id DESC LIMIT 2', [task]);
    return use.map(r => {
      let sum = '', diag = [], rec = [];
      if (r.report) {
        try {
          const rep = JSON.parse(r.report);
          sum = (rep.coach_summary || (rep.executive_summary && rep.executive_summary.overall) || '').slice(0, 160);
          diag = (rep.diagnoses || []).slice(0, 3).map(d => d.title);
          rec = (rep.recommendations || []).slice(0, 3).map(x => x.title || x.action);
        } catch {}
      }
      return { at: r.createdAt, task: r.task, title: r.title, sum, diag, rec };
    });
  }

  function trainingProgress() {
    const cfg = config.all ? config.all() : {};
    const out = [];
    for (const k of Object.keys(cfg || {})) {
      if (!k.startsWith('rpTrain:')) continue;
      const done = Array.isArray(cfg[k]) ? cfg[k].length : 0;
      const id = k.slice(8);
      const rep = db.get('SELECT title,report,createdAt FROM ai_reports WHERE id=?', [id]);
      let total = 0;
      if (rep && rep.report) { try { total = (JSON.parse(rep.report).training_plan || []).length; } catch {} }
      out.push({ reportId: id, title: rep ? rep.title : ('报告' + id), done, total, at: rep ? rep.createdAt : null });
    }
    return out.slice(0, 4);
  }

  function build(task, payload, opts = {}) {
    const sources = [];
    const L = [];
    const pu = selfPu();
    const allowPersonal = opts.allowPersonal !== false;
    const subject = String((payload && payload.subject) || 'global');

    // environment / 口径
    try {
      const f = queries.currentFilter(db, config);
      L.push(`[口径] 当前统计口径：${f.region === 'kr' ? '韩服' : f.region} ${f.tierFilter || ''} 版本 ${f.patch || '—'}（OP.GG/101 真实抓取）。`);
      sources.push('champion_stats 口径');
    } catch {}

    if (pu && allowPersonal) {
      const p = db.get('SELECT name,serverId,rankTier,rankDivision FROM players WHERE puuid=?', [pu]);
      const matches = players.cachedMatches(pu, 100);
      if (matches.length) {
        const st = players.computeStats(matches, pu);
        const rank = p && p.rankTier ? `${p.rankTier} ${p.rankDivision || ''}` : '段位未知';
        L.push(`[档案] 本人 ${p ? p.name : pu.slice(0, 8)}（${p ? p.serverId : '?'}）${rank}；缓存 ${st.total} 场 胜率 ${pct(st.winRate)}；近10场 ${st.recent10.games} 场 胜率 ${pct(st.recent10.winRate)}；当前 ${st.streak || 0} 连${st.streakType === 'W' ? '胜' : st.streakType === 'L' ? '败' : '—'}。`);
        L.push(`[形态] 场均 KDA ${st.avgKDA.toFixed(2)} / 死亡 ${st.avgDeaths.toFixed(1)} / 补刀 ${st.avgCs.toFixed(0)} / 视野 ${st.avgVision.toFixed(0)}；池深度 ${st.poolDepth}；绝活 ${(st.signature || []).map(c => champName(c.championId) + pct(c.winRate)).join('、') || '无（样本不足）'}。`);
        sources.push('本人缓存真实战绩 matches');
        // pool tags (proficiency / role correction)
        const tags = poolTags(pu);
        if (tags.length) {
          L.push(`[池管理] 用户自设熟练度/定位：${tags.map(t => champName(t.championId) + '=' + (t.proficiency || '未设') + (t.role ? '/' + t.role : '')).join('、')}。`);
          sources.push('player_pool 用户自设');
        }
        // position weakness hint (real)
        const weak = (st.byPosition || []).filter(x => x.games >= 5 && x.wins / x.games < 0.45);
        if (weak.length) L.push(`[位置] 样本≥5 且胜率<45% 的位置：${weak.map(w => w.position + ' ' + pct(w.wins / w.games)).join('、')}（真实缓存）。`);
      } else {
        L.push('[档案] 已设本人账号但暂无缓存战绩；不要编造个人数据。');
      }
    } else if (pu) {
      L.push('[档案] 已设本人账号，但隐私设置禁止发送个人战绩；本次不做个人化长期结论。');
    } else {
      L.push('[档案] 未设本人账号；本次仅就输入数据分析，不做个人化长期结论。');
    }

    // favorites / focus
    try {
      const fav = db.all('SELECT championKey FROM favorites LIMIT 8').map(r => r.championKey);
      if (fav.length) { L.push(`[收藏] 用户收藏英雄：${fav.join('、')}。`); sources.push('favorites'); }
      const focus = db.all('SELECT name,threat FROM player_focus LIMIT 6');
      if (focus.length) { L.push(`[关注] 标记玩家：${focus.map(f => f.name + (f.threat ? '(威胁)' : '')).join('、')}。`); sources.push('player_focus'); }
    } catch {}

    // training progress
    const tp = trainingProgress();
    if (tp.length) {
      L.push(`[训练] 历史训练计划完成度：${tp.map(t => `${t.title} ${t.done}/${t.total || '?'}`).join('；')}。结合完成度调整建议，避免重复已完成的训练项。`);
      sources.push('config rpTrain 训练勾选');
    }

    // memory: prior conclusions
    const mem = memory(subject, task);
    if (mem.length) {
      L.push('[记忆·历史报告结论]（供连续性参考，仍须以本次真实数据为准）');
      for (const m of mem) {
        L.push(`- ${m.at} 「${m.title}」${m.sum ? ' 总结:' + m.sum : ''}${m.diag.length ? ' 曾诊断:' + m.diag.join('/') : ''}${m.rec.length ? ' 曾建议:' + m.rec.join('/') : ''}`);
      }
      L.push('要求：对比上次结论指出「已改善/仍存在/新出现」，不要原样重复上次建议；若训练已完成则升级建议难度。');
      sources.push('ai_reports 历史结论');
    }

    // curated KB snippets relevant to task
    if (kb) {
      const hits = kb.search('', task, 2);
      if (hits.length) {
        L.push('[知识库·通用战术参考]（curated 非实时数据，仅作方法论参考）');
        for (const h of hits) L.push(`- ${h.title}：${h.body.slice(0, 140)}`);
        sources.push('本地 KB curated');
      }
    }

    let block = L.join('\n');
    if (block.length > MAX_CHARS) block = block.slice(0, MAX_CHARS) + '\n…（上下文超预算截断）';
    return { block, sources, hasSelf: !!pu, memoryCount: mem.length };
  }

  return { build, selfPu };
}

module.exports = { createAiContext, MAX_CHARS };