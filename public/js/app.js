import { columnChart, hBarChart, lineChart } from './charts.js';

/* ============================== 基础工具 ============================== */

const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const num = (v) => (v === null || v === undefined ? '—' : Number.isInteger(+v) ? String(v) : Number(v).toFixed(1));
const dec1 = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(1));
const pct = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`);
const shortDate = (d) => (d ? d.slice(5) : '');
const sourceLabel = (s) =>
  ({ 'seed-reset': '初始种子数据', 'csv-import': 'CSV 导入', 'manual-import': '手工导入', seed: '种子数据' }[s] ?? s ?? '—');

const isCompact = () => window.matchMedia('(max-width: 720px)').matches;

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (typeof body === 'string') {
      opts.body = body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(path, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(data?.error || data?.errors?.[0] || `请求失败（${res.status}）`);
    err.payload = data;
    throw err;
  }
  return data;
}

let toastTimer = null;
function showToast(message, kind = 'ok') {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = 'toast';
  }, 4200);
}

const loadingBlock = (text = '正在加载…') => `<div class="loading" role="status"><span class="spinner"></span>${esc(text)}</div>`;

function errorBlock(message) {
  return `<div class="error-card" role="alert">
    <h2>页面加载失败</h2>
    <p>${esc(message)}</p>
    <button class="btn btn-primary" id="retryBtn">重新加载</button>
  </div>`;
}

function setNav(name) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const active = link.dataset.nav === name;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/home';
  const [pathPart, queryPart] = raw.split('?');
  return { path: decodeURIComponent(pathPart || '/home'), params: new URLSearchParams(queryPart || '') };
}

const routes = [
  { re: /^\/home\/?$/, nav: 'home', view: viewHome },
  { re: /^\/course\/([A-Za-z0-9_-]+)$/, nav: 'home', view: viewCourse },
  { re: /^\/chapter\/([A-Za-z0-9_-]+)\/(\d+)$/, nav: 'home', view: viewChapter },
  { re: /^\/knowledge(?:\/([A-Za-z0-9_-]+))?$/, nav: 'knowledge', view: viewKnowledge },
  { re: /^\/dashboard\/?$/, nav: 'dashboard', view: viewDashboard },
  { re: /^\/insights\/?$/, nav: 'insights', view: viewInsights }
];

async function render() {
  const { path, params } = parseHash();
  const route = routes.find((r) => r.re.test(path)) ?? routes[0];
  setNav(route.nav);
  app.innerHTML = loadingBlock();
  try {
    await route.view(path.match(route.re)?.slice(1) ?? [], params);
  } catch (err) {
    console.error(err);
    app.innerHTML = errorBlock(err.message || '未知错误');
    document.querySelector('#retryBtn')?.addEventListener('click', () => location.reload());
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function refreshMeta() {
  const el = document.querySelector('#footer-meta');
  if (!el) return;
  try {
    const m = await api('/api/meta');
    el.textContent = `数据源：${sourceLabel(m.dataset.source)} · 最近更新：${fmtTime(
      m.dataset.updatedAt
    )} · 手工修改 ${m.dataset.manualEdits} 次 · Node.js + SQLite`;
  } catch {
    /* 页脚信息失败不影响页面 */
  }
}

/* ============================== 课程广场 ============================== */

const courseColor = (c) => c?.color || '#2F78C4';

function courseCard(c) {
  const s = c.stats ?? {};
  const completion = Math.max(0, Math.min(100, Number(s.completion) || 0));
  return `<article class="course-card" style="--accent:${esc(courseColor(c))}">
    <div class="course-top">
      <span class="course-badge" style="background:${esc(courseColor(c))}">${esc(c.badge || c.name.slice(0, 2))}</span>
      <span class="tag">${esc(c.category)}</span>
    </div>
    <h3><a class="stretched" href="#/course/${esc(c.id)}">${esc(c.name)}</a></h3>
    <p class="course-intro">${esc(c.intro)}</p>
    <p class="course-meta">${esc(c.teacher)} · ${esc(c.level)} · ${c.chapters.length} 章${
      c.video ? ' <span class="video-inline">▶ 视频导览</span>' : ''
    }</p>
    <div class="course-kpis">
      <span><b>${num(s.learners)}</b> 人学习</span>
      <span>完成率 <b>${pct(s.completion)}</b></span>
    </div>
    <div class="meter" aria-hidden="true"><span style="width:${completion}%"></span></div>
    <div class="course-foot">
      <span class="course-link">课程详情 <span aria-hidden="true">→</span></span>
      <a class="mini-link" href="#/knowledge/${esc(c.id)}">知识中心</a>
    </div>
  </article>`;
}

async function viewHome() {
  const data = await api('/api/courses');
  const o = data.overview;
  const home = { q: '', category: '全部', sort: 'default' };

  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">OPEN-SOURCE DEMO · NODE.JS + SQLITE</span>
        <h1>AI 学习与<br>数据分析门户</h1>
        <p>课程、知识中心与学习看板的一站式演示。<br>所有指标由 SQLite 实时计算——改一条数据，数字立即变化。</p>
        <div class="hero-actions">
          <a class="btn btn-light" href="#/dashboard">查看学习看板</a>
          <a class="btn btn-outline-light" href="#/knowledge/C1">浏览知识中心</a>
        </div>
      </div>
      <div class="hero-stats" aria-label="数据概览">
        <div class="hero-stat"><span>学生人数</span><strong>${num(o.students)}</strong><small>按 student_id 去重</small></div>
        <div class="hero-stat"><span>课程数量</span><strong>${num(o.courses)}</strong><small>演示数据集</small></div>
        <div class="hero-stat"><span>选课记录</span><strong>${num(o.enrollments)}</strong><small>学生 × 课程</small></div>
        <div class="hero-stat"><span>累计学习</span><strong>${dec1(o.totalHours)}<i>h</i></strong><small>${num(o.totalMinutes)} 分钟</small></div>
      </div>
    </section>

    <section class="section" aria-labelledby="coursesTitle">
      <div class="section-head">
        <div>
          <h2 id="coursesTitle">课程广场</h2>
          <p>5 门课程覆盖 AI 基础、提示词、数据分析、前端开发与安全使用。课程学习数据来自同一份模拟 CSV。</p>
        </div>
        <a class="btn btn-ghost btn-sm" href="#/insights">查看数据洞察 →</a>
      </div>

      <div class="toolbar" role="search">
        <div class="chips" id="catChips" aria-label="按分类筛选"></div>
        <input type="search" id="courseSearch" placeholder="搜索课程、讲师或关键词" aria-label="搜索课程">
        <select id="courseSort" aria-label="排序方式">
          <option value="default">默认顺序</option>
          <option value="learners">学习人数从多到少</option>
          <option value="completion">完成率从高到低</option>
          <option value="score">平均成绩从高到低</option>
        </select>
      </div>

      <div class="grid" id="courseGrid"></div>
      <p class="result-count" id="courseCount"></p>
    </section>`;

  const grid = document.querySelector('#courseGrid');
  const countEl = document.querySelector('#courseCount');
  const chips = document.querySelector('#catChips');
  const search = document.querySelector('#courseSearch');
  const sort = document.querySelector('#courseSort');

  function paint() {
    const cats = ['全部', ...data.categories];
    chips.innerHTML = cats
      .map(
        (c) =>
          `<button type="button" class="chip${home.category === c ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`
      )
      .join('');

    let list = data.courses.filter((c) => {
      const catOk = home.category === '全部' || c.category === home.category;
      const q = home.q.trim().toLowerCase();
      const qOk =
        !q ||
        [c.name, c.intro, c.teacher, c.category].some((v) => String(v).toLowerCase().includes(q));
      return catOk && qOk;
    });

    if (home.sort === 'learners') list = [...list].sort((a, b) => (b.stats?.learners ?? 0) - (a.stats?.learners ?? 0));
    if (home.sort === 'completion') list = [...list].sort((a, b) => (b.stats?.completion ?? 0) - (a.stats?.completion ?? 0));
    if (home.sort === 'score') list = [...list].sort((a, b) => (b.stats?.avgScore ?? 0) - (a.stats?.avgScore ?? 0));

    grid.innerHTML = list.length
      ? list.map(courseCard).join('')
      : `<div class="empty-state"><p>没有匹配的课程。</p><button class="btn btn-ghost btn-sm" id="clearSearch">清除筛选</button></div>`;
    countEl.textContent = `显示 ${list.length} / ${data.courses.length} 门课程 · 点击卡片标题进入课程详情`;

    const clear = document.querySelector('#clearSearch');
    if (clear) {
      clear.addEventListener('click', () => {
        home.q = '';
        home.category = '全部';
        search.value = '';
        paint();
      });
    }
  }

  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    home.category = btn.dataset.cat;
    paint();
  });
  search.addEventListener('input', () => {
    home.q = search.value;
    paint();
  });
  sort.addEventListener('change', () => {
    home.sort = sort.value;
    paint();
  });

  paint();
}

/* ============================== 课程详情 ============================== */

async function viewCourse(args) {
  const id = args[0];
  const { course, stats, chapterStats: chapterReach = [] } = await api(`/api/courses/${encodeURIComponent(id)}`);
  const s = stats ?? {};
  const chapterRows = chapterReach.length
    ? chapterReach
    : course.chapters.map((title, i) => ({ idx: i + 1, title, total: null }));
  const completion = Math.max(0, Math.min(100, Number(s.completion) || 0));
  const dashLink = `#/dashboard?course=${encodeURIComponent(course.name)}`;
  const v = course.video;
  const videoPanel = v
    ? `<section class="video-panel" aria-labelledby="courseVideoTitle">
        <div class="video-copy">
          <span class="eyebrow">课程导览视频</span>
          <h2 id="courseVideoTitle">先看一段 ${esc(v.durationText || v.duration)}的课程导览</h2>
          <p>${esc(v.note)}</p>
          <div class="video-meta">
            <span class="tag tag-video">占位视频</span>
            <span>时长 ${esc(v.durationText || v.duration)}</span>
            <span>无音频</span>
            <span>可按课程替换</span>
          </div>
        </div>
        <div class="video-frame">
          <video controls preload="metadata" playsinline poster="${esc(v.poster)}" aria-label="${esc(course.name)} 课程导览视频">
            <source src="${esc(v.src)}" type="video/mp4">
            你的浏览器不支持视频播放，可<a href="${esc(v.src)}" download>下载视频</a>。
          </video>
        </div>
      </section>`
    : '';

  app.innerHTML = `
    <nav class="crumbs" aria-label="面包屑">
      <a href="#/home">课程广场</a><span aria-hidden="true">/</span><span>${esc(course.name)}</span>
    </nav>

    <header class="detail-hero" style="--accent:${esc(courseColor(course))}">
      <span class="detail-badge" style="background:${esc(courseColor(course))}">${esc(course.badge)}</span>
      <div class="detail-copy">
        <div class="tag-row"><span class="tag">${esc(course.category)}</span><span class="tag tag-plain">${esc(course.level)}</span></div>
        <h1>${esc(course.name)}</h1>
        <p>${esc(course.intro)}</p>
        <div class="meta-row">
          <span>讲师：${esc(course.teacher)}</span>
          <span>${course.chapters.length} 个章节</span>
          <span>${num(s.learners)} 人正在学习</span>
          ${v ? `<span>含 ${esc(v.durationText || v.duration)}导览视频</span>` : ''}
        </div>
      </div>
      <div class="detail-actions">
        <a class="btn btn-primary" href="#/knowledge/${esc(course.id)}">进入知识中心</a>
        <a class="btn btn-ghost" href="${esc(dashLink)}">查看看板</a>
      </div>
    </header>

    <section class="stat-row" aria-label="课程数据概览">
      <article class="mini-stat"><span>学习人数</span><strong>${num(s.learners)}</strong><small>按学生编号去重</small></article>
      <article class="mini-stat"><span>学习记录</span><strong>${num(s.records)}</strong><small>原始 CSV 行数</small></article>
      <article class="mini-stat"><span>平均完成率</span><strong>${pct(s.completion)}</strong><small>每条选课最大进度</small></article>
      <article class="mini-stat"><span>平均测验成绩</span><strong>${dec1(s.avgScore)}</strong><small>有成绩 ${num(s.scoredEnrollments)} 条 · 无成绩 ${num(s.noScoreEnrollments)} 条</small></article>
    </section>

    ${videoPanel}

    <div class="detail-grid">
      <section class="panel" aria-labelledby="chaptersTitle" style="--accent:${esc(course.color)}">
        <h2 id="chaptersTitle">章节目录</h2>
        <p class="panel-sub">章节正文来自讲义原文；每章都配置统一示例视频；到达率按“完成章节总数”推断，假设按顺序学习。</p>
        <ol class="chapter-list">
          ${chapterRows
            .map(
              (ch) => `<li>
                <a class="chapter-row" href="#/chapter/${esc(course.id)}/${ch.idx}">
                  <span class="chapter-no">${String(ch.idx).padStart(2, '0')}</span>
                  <div class="chapter-info">
                    <h3>${esc(ch.title)} <span class="video-inline">▶ 视频</span></h3>
                    <p class="chapter-sub">讲义第 ${ch.idx} 章${
                      ch.total ? ` · ${ch.reached}/${ch.total} 人到达（${pct(ch.reachRate)}）` : ''
                    }</p>
                    ${
                      ch.total
                        ? `<span class="chapter-meter" aria-hidden="true"><span style="width:${Math.max(
                            0,
                            Math.min(100, Number(ch.reachRate) || 0)
                          )}%"></span></span>`
                        : ''
                    }
                  </div>
                  <span class="chapter-go">查看章节 <span aria-hidden="true">→</span></span>
                </a>
              </li>`
            )
            .join('')}
        </ol>
      </section>

      <aside class="panel side-panel" aria-labelledby="progressTitle">
        <h2 id="progressTitle">学习概览</h2>
        <div class="big-progress">
          <span class="big-value">${pct(s.completion)}</span>
          <span class="big-label">平均完成率</span>
          <div class="meter meter-lg" aria-hidden="true"><span style="width:${completion}%"></span></div>
        </div>
        <dl class="kv">
          <div><dt>平均测验成绩</dt><dd>${dec1(s.avgScore)} 分</dd></div>
          <div><dt>累计学习时长</dt><dd>${dec1(s.hours)} 小时</dd></div>
          <div><dt>选课条数</dt><dd>${num(s.enrollments)} 条</dd></div>
          <div><dt>无测验成绩</dt><dd>${num(s.noScoreEnrollments)} 条</dd></div>
        </dl>
        <p class="side-note">指标口径：每条学生 × 课程选课取 <code>max(chapters_done) / total_chapters</code>，再对选课求平均。</p>
        <a class="btn btn-ghost btn-block" href="${esc(dashLink)}">在学习看板中筛选本课程</a>
      </aside>
    </div>`;
}

/* ============================== 章节页 ============================== */

async function viewChapter(args) {
  const [courseId, idxStr] = args;
  const idx = Number(idxStr);
  const data = await api(`/api/chapters/${encodeURIComponent(courseId)}/${idx}`);
  const { course, chapter, stats: s, chapterStats: allChapters = [], relatedQuiz = [], prev, next } = data;
  const video = chapter.video;
  const reachWidth = Math.max(0, Math.min(100, Number(s?.reachRate) || 0));
  const quiz = relatedQuiz.length > 0;

  app.innerHTML = `
    <nav class="crumbs" aria-label="面包屑">
      <a href="#/home">课程广场</a><span aria-hidden="true">/</span>
      <a href="#/course/${esc(course.id)}">${esc(course.name)}</a><span aria-hidden="true">/</span>
      <span>第 ${idx} 章</span>
    </nav>

    <header class="chapter-head" style="--accent:${esc(course.color)}">
      <div>
        <span class="eyebrow">第 ${idx} 章 · ${esc(course.name)}</span>
        <h1>${esc(chapter.title)}</h1>
        <p>本章正文取自课程讲义原文；学习数据为按“完成章节总数”推断的参考值，不是逐章原始记录。</p>
        <div class="tag-row">
          <span class="tag">讲义原文</span>
          <span class="tag tag-plain">推断数据</span>
          <span class="tag tag-plain">${course.chapters.length} 章课程</span>
        </div>
      </div>
      <div class="chapter-head-actions">
        <a class="btn btn-ghost" href="#/course/${esc(course.id)}">返回课程</a>
        <a class="btn btn-ghost" href="#/knowledge/${esc(course.id)}">知识中心</a>
      </div>
    </header>

    <div class="chapter-layout">
      <div class="chapter-main">
        ${
          video
            ? `<section class="panel" aria-labelledby="chapterVideoTitle">
                <div class="panel-head">
                  <div>
                    <h2 id="chapterVideoTitle">本章示例视频</h2>
                    <p class="panel-sub">${esc(video.note)}</p>
                  </div>
                  <span class="tag tag-video-light">统一示例</span>
                </div>
                <div class="video-frame chapter-video-frame">
                  <video controls preload="metadata" playsinline poster="${esc(
                    video.poster
                  )}" aria-label="${esc(course.name)} 第 ${idx} 章示例视频">
                    <source src="${esc(video.src)}" type="video/mp4">
                    你的浏览器不支持视频播放，可<a href="${esc(video.src)}" download>下载视频</a>。
                  </video>
                </div>
                <p class="video-caption">时长 ${esc(video.durationText || video.duration)} · 无音频 · 所有章节共用同一片段，正式课程可按章节替换。</p>
              </section>`
            : ''
        }

        <section class="panel" aria-labelledby="lectureTitle">
          <div class="panel-head">
            <div>
              <h2 id="lectureTitle">本章原文</h2>
              <p class="panel-sub">来源：${esc(course.name)} · 课程讲义（未加入原文之外的内容）。</p>
            </div>
            <span class="tag">原文</span>
          </div>
          <div class="lecture-text">${lectureHtml(chapter.body)}</div>
        </section>

        <section class="panel" aria-labelledby="chapterQuizTitle">
          <div class="panel-head">
            <div>
              <h2 id="chapterQuizTitle">本章小测验</h2>
              <p class="panel-sub">${
                quiz ? `${relatedQuiz.length} 道题，答案、解析与讲义出处一并给出。` : '本章暂无对应测验，可到知识中心完成课程测验。'
              }</p>
            </div>
            ${quiz ? '<span class="tag">可交互</span>' : ''}
          </div>
          ${quiz ? quizBlock(relatedQuiz) : '<a class="btn btn-ghost btn-sm" href="#/knowledge/' + esc(course.id) + '">去知识中心 →</a>'}
        </section>

        <nav class="chapter-pager" aria-label="章节导航">
          ${
            prev
              ? `<a class="chapter-pager-link" href="#/chapter/${esc(course.id)}/${prev.idx}"><span>← 上一章</span><strong>第 ${prev.idx} 章 · ${esc(prev.title)}</strong></a>`
              : '<span></span>'
          }
          ${
            next
              ? `<a class="chapter-pager-link next" href="#/chapter/${esc(course.id)}/${next.idx}"><span>下一章 →</span><strong>第 ${next.idx} 章 · ${esc(next.title)}</strong></a>`
              : '<span></span>'
          }
        </nav>
      </div>

      <aside class="chapter-side">
        <section class="panel" aria-labelledby="chapterDataTitle">
          <div class="panel-head">
            <div>
              <h2 id="chapterDataTitle">本章学习数据</h2>
              <p class="panel-sub">推断口径 · 假设按顺序学习</p>
            </div>
            <span class="tag tag-warn">推断值</span>
          </div>
          <div class="chapter-rate">
            <strong>${pct(s?.reachRate)}</strong>
            <span>到达率</span>
          </div>
          <div class="meter meter-lg" aria-hidden="true"><span style="width:${reachWidth}%"></span></div>
          <dl class="kv">
            <div><dt>到达本章</dt><dd>${num(s?.reached)} / ${num(s?.total)} 人</dd></div>
            <div><dt>尚未到达</dt><dd>${num(s?.notReached)} 人</dd></div>
            <div><dt>到达者平均成绩</dt><dd>${
              s?.avgScoreReached === null || s?.avgScoreReached === undefined
                ? '— <small>（无成绩）</small>'
                : `${dec1(s.avgScoreReached)} 分 <small>（${num(s.scoredReached)} 条）</small>`
            }</dd></div>
            <div><dt>未到达者平均成绩</dt><dd>${
              s?.avgScoreNotReached === null || s?.avgScoreNotReached === undefined
                ? '— <small>（无成绩）</small>'
                : `${dec1(s.avgScoreNotReached)} 分 <small>（${num(s.scoredNotReached)} 条）</small>`
            }</dd></div>
          </dl>
          <p class="side-note">
            原始 CSV 只记录“完成章节总数”，没有逐章记录。到达率 = <code>max(chapters_done) ≥ 本章序号</code> 的选课数 ÷ 本课程选课数。
            仅用于演示与趋势参考，不能当作逐章原始数据。
          </p>
          <a class="btn btn-ghost btn-block" href="#/dashboard?course=${encodeURIComponent(course.name)}">查看课程看板</a>
        </section>

        <section class="panel" aria-labelledby="allChaptersTitle">
          <h2 id="allChaptersTitle">各章节到达率</h2>
          <p class="panel-sub">同一推断口径，用于比较章节之间的差异。</p>
          <ul class="chapter-rate-list">
            ${allChapters
              .map(
                (x) => `<li class="${x.idx === idx ? 'active' : ''}">
                  <a href="#/chapter/${esc(course.id)}/${x.idx}"${x.idx === idx ? ' aria-current="page"' : ''}>
                    <span class="rate-name">${x.idx}. ${esc(x.title)}</span>
                    <span class="rate-bar" aria-hidden="true"><span style="width:${Math.max(
                      0,
                      Math.min(100, Number(x.reachRate) || 0)
                    )}%"></span></span>
                    <em>${pct(x.reachRate)}</em>
                  </a>
                </li>`
              )
              .join('')}
          </ul>
        </section>

        <section class="panel">
          <h2>继续学习</h2>
          <div class="side-links">
            <a class="btn btn-primary btn-block" href="#/course/${esc(course.id)}">课程详情与导览视频</a>
            <a class="btn btn-ghost btn-block" href="#/knowledge/${esc(course.id)}">课程知识中心</a>
          </div>
        </section>
      </aside>
    </div>`;

  if (quiz) bindQuiz(relatedQuiz);
}

/* ============================== 知识中心 ============================== */

function lectureHtml(text) {
  const blocks = esc(text)
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      let html = '';
      let openList = null;
      const closeList = () => {
        if (openList) {
          html += `</${openList}>`;
          openList = null;
        }
      };
      for (const line of lines) {
        const bullet = line.match(/^-\s+(.*)$/);
        const numbered = line.match(/^\d+[.、]\s*(.*)$/);
        if (bullet) {
          if (openList !== 'ul') {
            closeList();
            html += '<ul>';
            openList = 'ul';
          }
          html += `<li>${bullet[1]}</li>`;
        } else if (numbered) {
          if (openList !== 'ol') {
            closeList();
            html += '<ol>';
            openList = 'ol';
          }
          html += `<li>${numbered[1]}</li>`;
        } else {
          closeList();
          html += `<p>${line}</p>`;
        }
      }
      closeList();
      return html;
    })
    .join('');
}

function quizBlock(quiz) {
  return `<form id="quizForm" class="quiz" novalidate>
    ${quiz
      .map(
        (q, qi) => `<fieldset class="quiz-item" data-q="${qi}">
          <legend><span class="qnum">Q${qi + 1}</span>${esc(q.q)}</legend>
          <div class="options">
            ${q.options
              .map(
                (opt, oi) => `<label class="option">
                  <input type="radio" name="q${qi}" value="${oi}">
                  <span>${esc(opt)}</span>
                </label>`
              )
              .join('')}
          </div>
          <p class="explain" data-explain="${qi}" hidden></p>
        </fieldset>`
      )
      .join('')}
    <div class="quiz-actions">
      <button type="submit" class="btn btn-primary">提交答案</button>
      <button type="button" class="btn btn-ghost" id="quizReset">重做</button>
      <span class="quiz-score" id="quizScore" role="status"></span>
    </div>
  </form>`;
}

function bindQuiz(quiz) {
  const form = document.querySelector('#quizForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let correct = 0;
    let answered = 0;
    quiz.forEach((q, qi) => {
      const selected = form.querySelector(`input[name="q${qi}"]:checked`);
      const labels = form.querySelectorAll(`fieldset[data-q="${qi}"] label`);
      labels.forEach((label, oi) => {
        label.classList.remove('right', 'wrong');
        if (oi === q.answer) label.classList.add('right');
        if (selected && Number(selected.value) === oi && oi !== q.answer) label.classList.add('wrong');
      });
      if (selected) {
        answered += 1;
        if (Number(selected.value) === q.answer) correct += 1;
      }
      const ex = form.querySelector(`[data-explain="${qi}"]`);
      if (ex) {
        ex.hidden = false;
        ex.innerHTML = `<strong>参考答案：${esc(q.options[q.answer])}</strong>　${esc(
          q.explanation
        )}　<span class="source">依据：${esc(q.source)}</span>`;
      }
    });
    const score = document.querySelector('#quizScore');
    score.textContent =
      answered < quiz.length
        ? `已作答 ${answered}/${quiz.length}，答对 ${correct}/${quiz.length}（已显示全部解析）`
        : `得分 ${correct}/${quiz.length}${correct === quiz.length ? '，全部正确！' : '，看解析再试一次'} `;
    score.className = `quiz-score ${correct === quiz.length && answered === quiz.length ? 'perfect' : ''}`;
  });

  document.querySelector('#quizReset')?.addEventListener('click', () => {
    form.reset();
    form.querySelectorAll('label').forEach((l) => l.classList.remove('right', 'wrong'));
    form.querySelectorAll('[data-explain]').forEach((x) => {
      x.hidden = true;
      x.textContent = '';
    });
    const score = document.querySelector('#quizScore');
    score.textContent = '';
    score.className = 'quiz-score';
  });
}

async function viewKnowledge(args) {
  const id = args[0] || 'C1';
  const [catalog, doc] = await Promise.all([api('/api/courses'), api(`/api/knowledge/${encodeURIComponent(id)}`)]);
  const k = doc.knowledge;

  app.innerHTML = `
    <nav class="crumbs" aria-label="面包屑">
      <a href="#/home">课程广场</a><span aria-hidden="true">/</span><span>知识中心</span><span aria-hidden="true">/</span><span>${esc(doc.course.name)}</span>
    </nav>

    <header class="page-head knowledge-head">
      <div>
        <span class="eyebrow">知识中心 · 依据讲义原文提炼</span>
        <h1>${esc(k.title)}</h1>
        <p>原始资料：${esc(k.source)}。摘要、知识点、术语、FAQ 与测验均来自原文，未加入原文之外的事实。</p>
      </div>
      <div class="tabs" role="tablist" aria-label="选择课程">
        ${catalog.courses
          .map(
            (c) => `<a role="tab" aria-selected="${c.id === id}" class="tab${c.id === id ? ' active' : ''}" href="#/knowledge/${esc(
              c.id
            )}">${esc(c.name)}</a>`
          )
          .join('')}
      </div>
    </header>

    <div class="knowledge-layout">
      <div class="knowledge-main">
        <section class="panel summary-panel">
          <div class="summary-label">200 字以内摘要</div>
          <p>${esc(k.summary)}</p>
        </section>

        <section class="panel">
          <h2>学习目标</h2>
          <ul class="objective-list">
            ${k.objectives.map((x) => `<li>${esc(x)}</li>`).join('')}
          </ul>
        </section>

        <section class="panel">
          <h2>5 个核心知识点</h2>
          <ol class="point-list">
            ${k.points.map((x) => `<li>${esc(x)}</li>`).join('')}
          </ol>
        </section>

        <section class="panel">
          <h2>术语解释</h2>
          <div class="term-grid">
            ${k.terms
              .map(
                (t) => `<article class="term-card"><h3>${esc(t.term)}</h3><p>${esc(t.definition)}</p></article>`
              )
              .join('')}
          </div>
        </section>

        <section class="panel">
          <h2>常见问题 FAQ</h2>
          <div class="faq-list">
            ${k.faq
              .map(
                (f, i) => `<details class="faq-item"${i === 0 ? ' open' : ''}>
                  <summary>${esc(f.q)}</summary>
                  <p>${esc(f.a)}</p>
                </details>`
              )
              .join('')}
          </div>
        </section>

        <section class="panel" aria-labelledby="quizTitle">
          <div class="panel-head">
            <div>
              <h2 id="quizTitle">随堂小测验</h2>
              <p class="panel-sub">3 道单选题，作答后显示答案、解析与讲义依据。</p>
            </div>
            <span class="tag tag-plain">可交互</span>
          </div>
          ${quizBlock(k.quiz)}
        </section>

        <section class="panel review-panel">
          <h2>人工修正记录</h2>
          <p class="panel-sub">保留一处 AI 初稿与人工修正的对照，便于追溯资料核查过程。</p>
          <div class="review-grid">
            <article class="review-before">
              <span class="review-tag">AI 初稿 · 待核对</span>
              <p>${esc(k.review.before)}</p>
            </article>
            <article class="review-after">
              <span class="review-tag">人工修正 · 对照原文</span>
              <p>${esc(k.review.after)}</p>
            </article>
          </div>
          <p class="review-note">${esc(k.review.note)}</p>
        </section>

        <section class="panel">
          <h2>原文摘录（核对用）</h2>
          <p class="panel-sub">知识中心的所有结论都可在此找到依据；若发现补充内容，请以此处原文为准。</p>
          <div class="original-list">
            ${k.original
              .map(
                (o) => `<details class="original-item">
                  <summary>${esc(o.chapter)}</summary>
                  <blockquote>${esc(o.text)}</blockquote>
                </details>`
              )
              .join('')}
          </div>
        </section>
      </div>

      <aside class="knowledge-side">
        <section class="panel side-panel">
          <h2>这门课</h2>
          <dl class="kv">
            <div><dt>课程</dt><dd>${esc(doc.course.name)}</dd></div>
            <div><dt>章节数</dt><dd>${doc.course.chapters.length}</dd></div>
            <div><dt>原始讲义</dt><dd>${esc(k.source)}</dd></div>
          </dl>
          <a class="btn btn-primary btn-block" href="#/course/${esc(doc.course.id)}">查看课程详情</a>
          <a class="btn btn-ghost btn-block" href="#/dashboard?course=${encodeURIComponent(doc.course.name)}">查看学习数据</a>
        </section>
        <section class="panel side-note-card">
          <h2>提炼规则</h2>
          <ul>
            <li>只依据讲义原文，不补充外部事实。</li>
            <li>每道题标注出处章节，便于人工复核。</li>
            <li>摘要控制在 200 字以内。</li>
          </ul>
        </section>
      </aside>
    </div>`;

  bindQuiz(k.quiz);
}

/* ============================== 学习看板 ============================== */

function kpiCard(k) {
  return `<article class="kpi-card" style="--kpi:${esc(k.color)}">
    <span class="kpi-label">${esc(k.label)}</span>
    <div class="kpi-value">${k.display ?? num(k.value)}<small>${esc(k.unit)}</small></div>
    <p class="kpi-hint">${esc(k.hint)}</p>
  </article>`;
}

function chartCard(title, subtitle, svg, note = '') {
  return `<article class="chart-card">
    <header><div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div>${note ? `<span class="chart-note">${esc(note)}</span>` : ''}</header>
    <div class="chart-body">${svg || '<p class="empty-chart">当前筛选下暂无数据</p>'}</div>
  </article>`;
}

function paintDashboard(d) {
  const body = document.querySelector('#dashBody');
  if (!body) return;
  const o = d.overview;
  const compact = isCompact();
  const colorMap = Object.fromEntries((d.courseCatalog ?? []).map((c) => [c.name, c.color]));
  const activeCourses = d.byCourse.filter((c) => c.learners > 0);

  const kpis = [
    { label: '学生人数', value: o.students, unit: '人', hint: `按 student_id 去重 · ${o.records} 条记录`, color: '#2F78C4' },
    { label: '选课数', value: o.enrollments, unit: '条', hint: '学生 × 课程唯一组合', color: '#06C7CC' },
    { label: '平均完成率', value: o.avgCompletion, display: dec1(o.avgCompletion), unit: '%', hint: '每条选课最大进度求平均', color: '#E8833A' },
    {
      label: '平均测验成绩',
      value: o.avgScore,
      display: dec1(o.avgScore),
      unit: '分',
      hint: `有成绩 ${o.scoredEnrollments} 条 · 无成绩 ${o.noScoreEnrollments} 条`,
      color: '#6C5CE7'
    },
    {
      label: '累计学习时长',
      value: o.totalHours,
      display: dec1(o.totalHours),
      unit: '小时',
      hint: `${o.totalMinutes} 分钟 ÷ 60`,
      color: '#1E9E6A'
    }
  ];

  const dailySvg =
    d.daily.length > 0
      ? lineChart({
          points: d.daily.map((x) => ({
            label: x.date,
            shortLabel: shortDate(x.date),
            value: x.sessions,
            display: `${x.sessions} 人次 / ${x.minutes} 分钟`
          })),
          color: '#2F78C4',
          ariaLabel: '每日学习人次趋势',
          compact
        })
      : '';

  const learnersSvg =
    activeCourses.length > 0
      ? hBarChart({
          items: activeCourses
            .slice()
            .sort((a, b) => b.learners - a.learners)
            .map((c) => ({
              label: c.course_name,
              value: c.learners,
              color: colorMap[c.course_name] || '#2F78C4',
              display: `${c.learners} 人`
            })),
          ariaLabel: '各课程学习人数',
              compact
            })
      : '';

  const completionSvg =
    activeCourses.length > 0
      ? hBarChart({
          items: activeCourses.map((c) => ({
            label: c.course_name,
            value: c.completion,
            color: colorMap[c.course_name] || '#2F78C4',
            display: pct(c.completion)
          })),
          max: 100,
          ariaLabel: '各课程平均完成率',
          compact
        })
      : '';

  const weekdaySvg = columnChart({
    items: d.weekday.map((w) => ({ label: w.label, value: w.sessions })),
    color: '#06C7CC',
    ariaLabel: '星期学习人次分布',
    compact
  });

  const bucketSvg = columnChart({
    items: d.completionBuckets.map((b) => ({ label: b.label, value: b.count, display: `${b.count} 条` })),
    color: '#E8833A',
    ariaLabel: '选课完成率分布',
    compact
  });

  const scoreSvg = columnChart({
    items: d.scoreBuckets.map((b) => ({ label: b.label, value: b.count, display: `${b.count} 条` })),
    color: '#6C5CE7',
    ariaLabel: '测验成绩分布',
    compact
  });

  const ds = d.dataset;
  body.innerHTML = `
    <p class="dataset-line">
      <span>数据源：<strong>${esc(sourceLabel(ds.source))}</strong></span>
      <span>最近更新 ${esc(fmtTime(ds.updatedAt))}</span>
      <span>手工修改 ${ds.manualEdits} 次</span>
      ${d.filter ? `<span class="filter-chip">当前筛选：${esc(d.filter)}</span>` : '<span class="filter-chip filter-chip-light">全部课程</span>'}
    </p>

    <section class="kpi-grid" aria-label="核心指标">${kpis.map(kpiCard).join('')}</section>

    <div class="chart-grid">
      ${chartCard('每日学习趋势', '学习人次 / 天', dailySvg, `${d.daily.length} 天`)}
      ${chartCard('各课程学习人数', '按学生编号去重', learnersSvg, '人')}
      ${chartCard('各课程平均完成率', '每条选课最大进度 / 总章数', completionSvg, '%')}
      ${chartCard('星期学习活跃度', '学习人次按星期汇总', weekdaySvg, '人次')}
      ${chartCard('选课完成率分布', '每条学生 × 课程选课', bucketSvg, '条')}
      ${chartCard('测验成绩分布', '仅统计有成绩的选课', scoreSvg, '条')}
    </div>

    ${
      d.insights.length
        ? `<section class="panel insight-preview">
            <div class="panel-head">
              <div><h2>数据洞察</h2><p class="panel-sub">由当前数据自动生成，${d.filter ? '范围：' + esc(d.filter) : '全站数据'}。</p></div>
              <a class="btn btn-ghost btn-sm" href="#/insights">全部洞察 →</a>
            </div>
            <div class="insight-grid compact">
              ${d.insights
                .slice(0, 2)
                .map(
                  (i) => `<article class="insight-card" data-type="${esc(i.type)}">
                    <span class="insight-tag">${esc(i.tag)}</span>
                    <h3>${esc(i.title)}</h3>
                    <p>${esc(i.evidence)}</p>
                  </article>`
                )
                .join('')}
            </div>
          </section>`
        : ''
    }

    <p class="footnote">提示：展开下方“数据演示”，修改任意一条学习记录并保存，KPI 与图表会重新计算。也可以导入修改后的 CSV 或恢复初始数据。</p>`;
}

function demoPanelHtml(catalog) {
  return `<details class="demo-panel" id="demoPanel">
    <summary>
      <span class="demo-title">数据演示（可编辑）</span>
      <span class="demo-sub">改一条记录，看指标变化 · 导入 CSV · 恢复初始数据</span>
    </summary>
    <div class="demo-body">
      <p class="demo-tip">
        所有指标都由服务端从 SQLite 重新计算：把某条记录的 <code>chapters_done</code> 改大或改小，保存后上方 KPI 与图表会立即刷新。
        演示时可现场验证“改数据 → 指标变化”。
      </p>
      <div class="toolbar demo-toolbar">
        <input type="search" id="recSearch" placeholder="搜索学生编号或课程" aria-label="搜索学习记录">
        <select id="recCourse" aria-label="按课程筛选记录">
          <option value="">全部课程</option>
          ${catalog.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-primary btn-sm" id="recAdd">＋ 新增记录</button>
        <button type="button" class="btn btn-ghost btn-sm" id="recImport">导入 CSV</button>
        <a class="btn btn-ghost btn-sm" href="/api/export.csv" download>导出 CSV</a>
        <button type="button" class="btn btn-danger-ghost btn-sm" id="recReset">恢复初始数据</button>
        <input type="file" id="recFile" accept=".csv,text/csv" hidden>
      </div>
      <div class="table-wrap">
        <table class="record-table">
          <caption class="sr-only">学习记录（每页 10 条）</caption>
          <thead><tr>
            <th scope="col">ID</th><th scope="col">学生</th><th scope="col">课程</th><th scope="col">日期</th>
            <th scope="col" class="num">分钟</th><th scope="col" class="num">章节</th><th scope="col" class="num">成绩</th><th scope="col">操作</th>
          </tr></thead>
          <tbody id="recRows"><tr><td colspan="8">正在加载…</td></tr></tbody>
        </table>
      </div>
      <div class="pager">
        <button type="button" class="btn btn-ghost btn-sm" id="recPrev">上一页</button>
        <span id="recPage" class="pager-info"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="recNext">下一页</button>
      </div>
    </div>
  </details>

  <dialog id="recordDialog" class="record-dialog" aria-labelledby="dlgTitle">
    <form id="recordForm">
      <header class="dialog-head">
        <h2 id="dlgTitle">编辑学习记录</h2>
        <button type="button" class="icon-btn" data-close aria-label="关闭">✕</button>
      </header>
      <input type="hidden" name="id">
      <div class="form-grid">
        <label>学生编号<input name="student_id" required maxlength="32" placeholder="S001" autocomplete="off"></label>
        <label>课程<select name="course_name" required>
          ${catalog.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
        </select></label>
        <label>学习日期<input type="date" name="learning_date" required></label>
        <label>学习时长（分钟）<input type="number" name="learning_minutes" min="0" max="1440" step="1" required></label>
        <label>已完成章节<input type="number" name="chapters_done" min="0" step="1" required></label>
        <label>总章节数<input type="number" name="total_chapters" min="1" step="1" required></label>
        <label class="span-2">测验成绩（可留空）<input type="number" name="quiz_score" min="0" max="100" step="0.1" placeholder="留空表示未参加测验"></label>
      </div>
      <div class="form-error" id="formError" role="alert" hidden></div>
      <footer class="dialog-foot">
        <button type="button" class="btn btn-ghost" data-close>取消</button>
        <button type="submit" class="btn btn-primary">保存并重算</button>
      </footer>
    </form>
  </dialog>`;
}

function bindDemoPanel({ refreshDashboard, catalog }) {
  const rec = { offset: 0, q: '', course: '' };
  const rowMap = new Map();
  const dialog = document.querySelector('#recordDialog');
  const form = document.querySelector('#recordForm');
  const errorBox = document.querySelector('#formError');
  const rowsEl = document.querySelector('#recRows');
  const pageEl = document.querySelector('#recPage');

  async function loadRecords() {
    rowsEl.innerHTML = `<tr><td colspan="8">正在加载…</td></tr>`;
    const qs = new URLSearchParams({ limit: '10', offset: String(rec.offset) });
    if (rec.q) qs.set('q', rec.q);
    if (rec.course) qs.set('course', rec.course);
    try {
      const data = await api(`/api/records?${qs}`);
      rowMap.clear();
      data.rows.forEach((r) => rowMap.set(r.id, r));
      rowsEl.innerHTML = data.rows.length
        ? data.rows
            .map(
              (r) => `<tr>
                <td>${r.id}</td>
                <td><code>${esc(r.student_id)}</code></td>
                <td>${esc(r.course_name)}</td>
                <td>${esc(r.learning_date)}</td>
                <td class="num">${r.learning_minutes}</td>
                <td class="num">${r.chapters_done}/${r.total_chapters}</td>
                <td class="num">${r.quiz_score === null ? '<span class="muted">—</span>' : r.quiz_score}</td>
                <td class="actions">
                  <button type="button" class="btn-link" data-edit="${r.id}">编辑</button>
                  <button type="button" class="btn-link danger-text" data-del="${r.id}">删除</button>
                </td>
              </tr>`
            )
            .join('')
        : `<tr><td colspan="8" class="muted">没有匹配的记录</td></tr>`;
      const pages = Math.max(1, Math.ceil(data.total / data.limit));
      pageEl.textContent = `第 ${Math.floor(data.offset / data.limit) + 1} / ${pages} 页 · 共 ${data.total} 条`;
      document.querySelector('#recPrev').disabled = data.offset <= 0;
      document.querySelector('#recNext').disabled = data.offset + data.limit >= data.total;
    } catch (err) {
      rowsEl.innerHTML = `<tr><td colspan="8" class="danger-text">${esc(err.message)}</td></tr>`;
    }
  }

  function openDialog(record) {
    errorBox.hidden = true;
    errorBox.textContent = '';
    form.reset();
    const isEdit = Boolean(record);
    document.querySelector('#dlgTitle').textContent = isEdit ? `编辑记录 #${record.id}` : '新增学习记录';
    const f = form.elements;
    f.id.value = isEdit ? record.id : '';
    f.student_id.value = isEdit ? record.student_id : '';
    f.course_name.value = isEdit ? record.course_name : rec.course || catalog[0]?.name || '';
    f.learning_date.value = isEdit ? record.learning_date : new Date().toISOString().slice(0, 10);
    f.learning_minutes.value = isEdit ? record.learning_minutes : 45;
    f.chapters_done.value = isEdit ? record.chapters_done : 1;
    f.total_chapters.value = isEdit ? record.total_chapters : 5;
    f.quiz_score.value = isEdit && record.quiz_score !== null ? record.quiz_score : '';
    dialog.showModal();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const id = f.id.value;
    const payload = {
      student_id: f.student_id.value.trim(),
      course_name: f.course_name.value,
      learning_date: f.learning_date.value,
      learning_minutes: Number(f.learning_minutes.value),
      chapters_done: Number(f.chapters_done.value),
      total_chapters: Number(f.total_chapters.value),
      quiz_score: f.quiz_score.value === '' ? null : Number(f.quiz_score.value)
    };
    errorBox.hidden = true;
    try {
      if (id) await api(`/api/records/${id}`, { method: 'PATCH', body: payload });
      else await api('/api/records', { method: 'POST', body: payload });
      dialog.close();
      showToast(id ? '记录已更新，指标已重新计算' : '记录已新增，指标已重新计算');
      await Promise.all([refreshDashboard(), loadRecords()]);
      refreshMeta();
    } catch (err) {
      errorBox.hidden = false;
      errorBox.textContent = (err.payload?.errors ?? [err.message]).join('；');
    }
  });

  dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  rowsEl.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) {
      const record = rowMap.get(Number(edit.dataset.edit));
      if (record) openDialog(record);
    }
    if (del) {
      const id = Number(del.dataset.del);
      if (!confirm(`确定删除记录 #${id}？删除后指标会立即重算。`)) return;
      try {
        await api(`/api/records/${id}`, { method: 'DELETE' });
        showToast('记录已删除，指标已重新计算');
        rec.offset = Math.max(0, rec.offset - 1);
        await Promise.all([refreshDashboard(), loadRecords()]);
        refreshMeta();
      } catch (err) {
        showToast(err.message, 'err');
      }
    }
  });

  document.querySelector('#recAdd').addEventListener('click', () => openDialog(null));

  let searchTimer = null;
  document.querySelector('#recSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      rec.q = e.target.value.trim();
      rec.offset = 0;
      loadRecords();
    }, 250);
  });

  document.querySelector('#recCourse').addEventListener('change', (e) => {
    rec.course = e.target.value;
    rec.offset = 0;
    loadRecords();
  });

  document.querySelector('#recPrev').addEventListener('click', () => {
    rec.offset = Math.max(0, rec.offset - 10);
    loadRecords();
  });

  document.querySelector('#recNext').addEventListener('click', () => {
    rec.offset += 10;
    loadRecords();
  });

  const fileInput = document.querySelector('#recFile');
  document.querySelector('#recImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const csv = await file.text();
      const res = await api('/api/records/import', { method: 'POST', body: { csv } });
      const extra = res.errors?.length ? `；首个问题：${res.errors[0]}` : '';
      showToast(`导入完成：写入 ${res.inserted} 条，跳过 ${res.skipped} 条${extra}`, res.skipped ? 'warn' : 'ok');
      rec.offset = 0;
      await Promise.all([refreshDashboard(), loadRecords()]);
      refreshMeta();
    } catch (err) {
      const msg = err.payload?.errors?.length ? err.payload.errors.slice(0, 3).join('；') : err.message;
      showToast(`导入失败：${msg}`, 'err');
    } finally {
      fileInput.value = '';
    }
  });

  document.querySelector('#recReset').addEventListener('click', async () => {
    if (!confirm('恢复初始数据？所有手工修改与导入内容都会被清空。')) return;
    try {
      const res = await api('/api/admin/reset', { method: 'POST' });
      showToast(`已恢复初始数据：${res.inserted} 条记录`);
      rec.offset = 0;
      await Promise.all([refreshDashboard(), loadRecords()]);
      refreshMeta();
    } catch (err) {
      showToast(`恢复失败：${err.message}`, 'err');
    }
  });

  loadRecords();
}

async function viewDashboard(args, params) {
  let filter = params.get('course') || '';
  let d = await api(`/api/dashboard${filter ? `?course=${encodeURIComponent(filter)}` : ''}`);
  if (filter && !d.courseOptions.includes(filter)) filter = '';

  app.innerHTML = `
    <header class="page-head">
      <div>
        <span class="eyebrow">学习看板 · 数据实时计算</span>
        <h1>学习数据总览</h1>
        <p>指标来自 SQLite 中的原始学习记录，不使用任何写死的数字。默认口径：一条选课 = 一个学生 × 一门课程。</p>
      </div>
      <div class="dash-controls">
        <label for="dashFilter">课程筛选</label>
        <select id="dashFilter">
          <option value="">全部课程</option>
          ${d.courseOptions.map((n) => `<option value="${esc(n)}"${n === filter ? ' selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-ghost btn-sm" id="dashRefresh">刷新</button>
      </div>
    </header>
    <div id="dashBody">${loadingBlock('正在计算指标…')}</div>
    ${demoPanelHtml(d.courseCatalog ?? [])}`;

  let currentFilter = filter;

  async function refreshDashboard() {
    const data = await api(`/api/dashboard${currentFilter ? `?course=${encodeURIComponent(currentFilter)}` : ''}`);
    paintDashboard(data);
    const badge = document.querySelector('.filter-chip');
    if (badge) badge.textContent = currentFilter ? `当前筛选：${currentFilter}` : '全部课程';
  }

  paintDashboard(d);

  document.querySelector('#dashFilter').addEventListener('change', async (e) => {
    currentFilter = e.target.value;
    const hash = `#/dashboard${currentFilter ? `?course=${encodeURIComponent(currentFilter)}` : ''}`;
    history.replaceState(null, '', hash);
    await refreshDashboard();
  });

  document.querySelector('#dashRefresh').addEventListener('click', async () => {
    await refreshDashboard();
    showToast('指标已刷新');
  });

  bindDemoPanel({ refreshDashboard, catalog: d.courseCatalog ?? [] });
}

/* ============================== 数据洞察 ============================== */

const insightAccent = {
  progress: '#2F78C4',
  correlation: '#06C7CC',
  timing: '#E8833A',
  quality: '#D64545',
  comparison: '#6C5CE7'
};

async function viewInsights() {
  const d = await api('/api/insights');
  const o = d.overview;

  const formulaRows = [
    ['学生人数', 'COUNT(DISTINCT student_id)', `${num(o.students)} 人`],
    ['课程数量', 'COUNT(DISTINCT course_name)', `${num(o.courses)} 门`],
    ['选课数', 'COUNT(DISTINCT student_id + course_name)', `${num(o.enrollments)} 条`],
    ['平均完成率', 'mean( max(chapters_done) / total_chapters )，按选课分组', pct(o.avgCompletion)],
    [
      '平均测验成绩',
      `mean(quiz_score)，只统计有成绩的选课`,
      `${dec1(o.avgScore)} 分（有成绩 ${o.scoredEnrollments} 条 / 无成绩 ${o.noScoreEnrollments} 条）`
    ],
    ['累计学习时长', 'SUM(learning_minutes) ÷ 60', `${dec1(o.totalHours)} 小时（${num(o.totalMinutes)} 分钟）`]
  ];

  app.innerHTML = `
    <header class="page-head">
      <div>
        <span class="eyebrow">数据洞察 · 有数据支撑的结论</span>
        <h1>从学习记录里读出什么</h1>
        <p>以下结论由当前数据库中的记录自动计算并生成；每条都给出具体数字与可执行建议，可在学习看板中找到依据。</p>
      </div>
      <a class="btn btn-ghost" href="#/dashboard">回到学习看板</a>
    </header>

    <section class="snapshot-row" aria-label="数据快照">
      <div><span>学生</span><strong>${num(o.students)}</strong></div>
      <div><span>选课</span><strong>${num(o.enrollments)}</strong></div>
      <div><span>平均完成率</span><strong>${pct(o.avgCompletion)}</strong></div>
      <div><span>平均成绩</span><strong>${dec1(o.avgScore)}</strong></div>
      <div><span>累计学习</span><strong>${dec1(o.totalHours)}h</strong></div>
    </section>

    <section class="insight-section" aria-labelledby="insightTitle">
      <div class="section-head">
        <div><h2 id="insightTitle">${d.insights.length} 条数据洞察</h2><p>作业要求 ≥2 条；这里由规则从数据实时生成，不是写死的文案。</p></div>
      </div>
      <div class="insight-grid">
        ${d.insights
          .map(
            (i) => `<article class="insight-card" data-type="${esc(i.type)}" style="--accent:${insightAccent[i.type] || '#2F78C4'}">
              <span class="insight-tag">${esc(i.tag)}</span>
              <h3>${esc(i.title)}</h3>
              <p class="insight-evidence">${esc(i.evidence)}</p>
              <p class="insight-action"><strong>建议：</strong>${esc(i.action)}</p>
            </article>`
          )
          .join('')}
      </div>
    </section>

    <section class="panel" aria-labelledby="formulaTitle">
      <div class="panel-head">
        <div><h2 id="formulaTitle">口径与公式</h2><p class="panel-sub">“这个数是怎么算的”必须能回答——下面是页面上每个指标的计算方式。</p></div>
        <span class="tag tag-plain">可复核</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th scope="col">指标</th><th scope="col">口径 / 公式</th><th scope="col">当前值</th></tr></thead>
          <tbody>
            ${formulaRows
              .map(([m, f, v]) => `<tr><td><strong>${esc(m)}</strong></td><td><code>${esc(f)}</code></td><td>${esc(v)}</td></tr>`)
              .join('')}
          </tbody>
        </table>
      </div>
      <div class="quality-row">
        <span>数据区间：<strong>${esc(d.quality.dateFrom ?? '—')}</strong> 至 <strong>${esc(d.quality.dateTo ?? '—')}</strong>（${d.quality.days} 天）</span>
        <span>原始记录：<strong>${num(o.records)}</strong> 条</span>
        <span>数据源：<strong>${esc(sourceLabel(d.dataset.source))}</strong></span>
        <span>手工修改：<strong>${d.dataset.manualEdits}</strong> 次</span>
      </div>
    </section>

    <section class="panel" aria-labelledby="pitfallTitle">
      <div class="panel-head">
        <div><h2 id="pitfallTitle">常见口径误区</h2><p class="panel-sub">这些是把数据算错时最常见的错值；页面上的正确值已由 SQLite 重新计算。</p></div>
        <span class="tag tag-warn">演示</span>
      </div>
      <div class="pitfall-grid">
        ${d.pitfalls
          .map(
            (p) => `<article class="pitfall-card">
              <div class="pitfall-top"><h3>${esc(p.metric)}</h3><span class="wrong-value">常见错值：${esc(p.wrong)}</span></div>
              <p>${esc(p.reason)}</p>
              <p class="pitfall-right">正确做法：<code>${esc(p.correctHint)}</code></p>
            </article>`
          )
          .join('')}
      </div>
    </section>

    <section class="panel demo-note">
      <h2>如何验证“数字不是写死的”</h2>
      <ol class="steps">
        <li>打开学习看板，记录当前“平均完成率”和“平均测验成绩”。</li>
        <li>在页面底部展开“数据演示”，编辑一条记录（例如把 <code>chapters_done</code> 加 1）。</li>
        <li>保存后确认 KPI 与图表变化；再点“恢复初始数据”回到参考值。</li>
        <li>或者导出 CSV、改一个值、重新导入，验证指标体系同样随数据变化。</li>
      </ol>
    </section>`;

  refreshMeta();
}

/* ============================== 启动 ============================== */

if (!location.hash) history.replaceState(null, '', '#/home');
window.addEventListener('hashchange', render);
refreshMeta();
render();