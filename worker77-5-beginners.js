// ===== VERSION MARKER: V80-ADMIN-REVIEW-BINGFIX =====
// V80-BINGFIX: 「前往原文」備援搜尋由 Google 改為 Bing(大陸/全球皆可開);其餘與 V80-ADMIN-REVIEW 相同
// V77: 新增「菜鳥之友(Beginner's Hub)」主版塊(/beginners)+ 子版塊(AI與加密貨幣 / 經驗之談)
//     - 文章分類新增:菜鳥之友 / AI與加密貨幣 / 經驗之談(articles.category 為純文字欄位,程式層即可支援)
//     - 新增 /api/articles 依分類查詢文章的 JSON 接口(GET query / POST JSON body 皆可)
//     - 導覽列新增下拉選單(懸停/點擊顯示子版塊)+ 行動版漢堡選單(可展開子版塊)
//     - 頭像 CSS(V76-5-AVATAR-FULL-DISPLAY)原樣保留
// V77-TSFIX: buildHeadMeta/buildArticleJsonLd 的解構參數補預設值,讓 type/image/authorName/authorUrl 在
//            型別檢查(checkJs)下成為「可選」,消除全部 ts(2345)「missing properties」提示(行為不變)
// V78: 新增「歡迎投稿」：/tougao 投稿頁(網頁直接收稿,不經 Email)+ 表單 POST /tougao + JSON API /api/submit-article
//     - 稿件寫入 D1 submissions 表(status='pending' 待審),未審稿件絕不出現在前端,審查通過才轉存 articles 發佈
//     - 首次投稿自動 CREATE TABLE IF NOT EXISTS submissions(冪等,也可手動在 D1 Console 建表)
//     - 防濫發:蜜罐欄位 + 同IP每日5篇 + 全站每日200篇上限;首頁 Hero 加入醒目「歡迎投稿」按鈕與導覽列入口
// V78-LINKFIX: 新聞詳情頁「前往原文」按鈕改經 safeOriginalLink() 驗證 — 只允許 http(s) 外部網址;
//              相對路徑(例如 link 誤填成 /ai-chat-xxx)、空值、危險協議一律改為 Google 搜尋標題,
//              避免點擊後跳到站內不存在的路徑(404)
// V79: 兌換碼時長可配置 — /redeem 兌換時改用 access_codes.duration_days(單位:天)計算權限到期日,
//      缺省/無效(0、負數、非數字、欄位不存在)時回退 SESSION_DURATION_DAYS(365天),完全向後相容
//      D1 需執行: ALTER TABLE access_codes ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 365;
// V80: 管理審稿頁(受 SUBMISSIONS_ADMIN_KEY 環境變數保護):
//      GET /admin 登入 → POST /admin/login 驗證 → GET /admin/submissions 待審清單
//      POST /admin/submissions/action 一鍵發佈/退回;發佈自動寫入 articles/literature 並生成兌換碼(SYGIFT-xxxxxx)
//      發佈時可選分類與薄酬時長(30/90/365天);access_codes 無 duration_days 欄位時自動降級(固定365天)
//      未設定 SUBMISSIONS_ADMIN_KEY 時管理頁鎖定;所有管理頁加 X-Robots-Tag:noindex

export default {
  async fetch(request, env, ctx) {
    // V76-3: 把「目前的 request」掛到 env 副本上(env 是每次請求的新物件,不同請求互不干擾),
    // 讓深層翻譯邏輯能讀到 request 做爬蟲識別 — 搜尋引擎蜘蛛/爬蟲訪問未翻譯的英文頁面時,
    // 一律回傳中文或讀取既有快取,絕不觸發翻譯 AI;不需穿透修改十幾個渲染函式簽名
    let reqEnv = env;
    try {
      reqEnv = Object.assign({}, env, { __request: request });
    } catch (e) {
      reqEnv = env;
    }
    return handleRequest(request, reqEnv, ctx);
  },
};

async function handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    const { lang, remainder } = parseLang(url.pathname);

    // V75-FIX: 所有頁面路由一律透過 safe(..., request) 包覆,任何渲染錯誤都會回傳
    // 「含頂部導覽列」的完整 HTML 錯誤頁,導覽列 100% 優先繪製、絕不丟失
    if (remainder === "/" ) return await safe(() => renderHome(env, lang, false, request), request);
    if (remainder === "/news") return await safe(() => renderHome(env, lang, true, request), request);
    if (remainder === "/news/read") return await safe(() => renderNewsItem(url, env, lang, request), request);
    if (remainder === "/literature") return await safe(() => renderLiteratureList(env, lang, url), request);
    if (remainder === "/literature/read") return await safe(() => renderLiteratureItem(url, env, lang), request);
    if (remainder === "/media") return await safe(() => renderMediaPage(env, lang, url), request);
    if (remainder === "/tools") return await safe(() => renderToolsPage(request, env, lang), request);
    if (remainder.startsWith("/tools/premium/")) return await safe(() => renderPremiumTool(request, env, lang, remainder.slice("/tools/premium/".length)), request);
    if (remainder.startsWith("/tools/")) return renderToolFile(remainder.slice("/tools/".length), lang);
    if (remainder === "/guide") return await safe(() => renderGuideList(env, lang), request);
    if (remainder === "/guide/read") return await safe(() => renderGuideItem(url, env, lang), request);
    // V77: 菜鳥之友(Beginner's Hub)主版塊;文章詳情沿用 /news/read?id=(articles 表同一資料源)
    if (remainder === "/beginners") return await safe(() => renderBeginnersPage(env, lang, url, request), request);
    // V78: 歡迎投稿(網頁直接收稿;POST 表單走 /tougao,GET 顯示表單頁;注意 POST 判斷必須在 GET 之前)
    if (remainder === "/tougao" && request.method === "POST") return await safe(() => handleTougaoSubmit(request, env, lang), request);
    if (remainder === "/tougao") return await safe(() => renderTougaoPage(env, lang, url), request);

    if (remainder === "/sitemap.xml") return await safe(() => renderSitemap(env), request);
    if (remainder === "/robots.txt") return renderRobotsTxt();

    if (remainder === "/about") return await safe(() => renderAboutPage(lang), request);
    if (remainder === "/author/shengyan") return await safe(() => renderAuthorPage(env, lang), request);
    if (remainder === "/editorial-policy") return await safe(() => renderPolicyPage(env, lang, "editorial-policy", "/editorial-policy"), request);
    if (remainder === "/privacy-policy") return await safe(() => renderPolicyPage(env, lang, "privacy-policy", "/privacy-policy"), request);
    if (remainder === "/contact") return await safe(() => renderPolicyPage(env, lang, "contact", "/contact"), request);
    if (remainder === "/redeem") return await safe(() => renderRedeemPage(request, env, lang, url), request);
    if (remainder === "/api/globalease/generate" && request.method === "POST") return await safe(() => handleGlobalEaseGenerate(request, env), request);
    if (remainder === "/api/media-download" && request.method === "POST") return await safe(() => handleMediaDownload(request, env), request);
    if (remainder === "/login") return await safe(() => renderLoginPage(request, env, lang, url), request);
    if (remainder === "/free") return await safe(() => renderFreePage(lang), request);
    if (remainder === "/pricing") return await safe(() => renderPolicyPage(env, lang, "pricing", "/pricing"), request);
    // V75-FIX: /en/api/media JSON 端點,提供多媒體清單數據,避免前端等待不到數據
    if (remainder === "/api/media") return await safe(() => renderMediaApi(env), request);
    // V77: 依分類查詢文章的 JSON 接口(菜鳥之友主/子版塊共用;GET query 或 POST JSON body)
    if (remainder === "/api/articles" && (request.method === "GET" || request.method === "POST")) return await safe(() => renderArticlesApi(env, url, request), request);
    // V78: 網頁投稿 JSON 接口(供前端 fetch 或第三方整合)
    if (remainder === "/api/submit-article" && request.method === "POST") return await safe(() => handleSubmitArticleApi(request, env), request);

 // V80: 管理審稿(受 SUBMISSIONS_ADMIN_KEY 保護;未登入一律導向 /admin 登入頁)
 if (remainder === "/admin") return await safe(() => renderAdminPage(request, env), request);
 if (remainder === "/admin/login" && request.method === "POST") return await safe(() => handleAdminLogin(request, env), request);
 if (remainder === "/admin/logout" && request.method === "POST") return await safe(() => handleAdminLogout(request, env), request);
 if (remainder === "/admin/submissions") return await safe(() => renderAdminSubmissions(request, env), request);
 if (remainder === "/admin/submissions/action" && request.method === "POST") return await safe(() => handleAdminAction(request, env), request);

    return new Response("Not Found", { status: 404 });
}

// V75-FIX: 頁面渲染錯誤時,回傳「含頂部導覽列 + 頁尾」的完整 HTML 錯誤頁,
// 不再回傳純文字,確保 /en/ 或任何語言下導覽列 100% 優先繪製、絕不丟失
async function safe(fn, request) {
  try {
    return await fn();
  } catch (e) {
    let lang = "zh-Hant";
    let navPath = "/";
    try {
      if (request) {
        const u = new URL(request.url);
        const parsed = parseLang(u.pathname);
        lang = parsed.lang;
        navPath = parsed.remainder || "/";
      }
    } catch (e2) {}
    const errTitle = lang === "en" ? "Something went wrong" : "頁面出現錯誤";
    const errBody = (e && e.message) ? e.message : "Unknown error";
    const errHtml = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(errTitle)} - ${escapeHtml(t(lang, "site_name"))}</title>
<style>${BASE_STYLE}</style>
</head>
<body>
  ${buildNav(lang, navPath)}
  <div class="content-wrap">
    <h1>${escapeHtml(errTitle)}</h1>
    <p>${escapeHtml(errBody)}</p>
    <p><a href="${langPrefix(lang)}/">${escapeHtml(t(lang, "nav_home"))}</a></p>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;
    return new Response(errHtml, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

// V75-FIX: /api/media 與 /en/api/media JSON 數據端點(多媒體清單,永遠快速返回,不做AI翻譯)
async function renderMediaApi(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, series_title, chapter_no, language, youtube_url, description, category FROM media ORDER BY id DESC"
  ).all();
  return new Response(JSON.stringify({ ok: true, count: (results || []).length, items: results || [] }), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ===== V77: 依分類查詢文章的 JSON 接口 =====
// GET  /api/articles?category=菜鳥之友&limit=10 (category 留空 = 全部文章)
// POST /api/articles  body: { "category": "AI與加密貨幣", "limit": 5 }
// 回傳原始資料(不做AI翻譯),與 /api/media 行為一致;limit 預設 20、上限 100
async function renderArticlesApi(env, url, request) {
  let params = url ? url.searchParams : new URLSearchParams();
  if (request && request.method === "POST") {
    try {
      const body = await request.clone().json();
      if (body && typeof body === "object") {
        const merged = new URLSearchParams(params);
        if (body.category) merged.set("category", String(body.category));
        if (body.limit) merged.set("limit", String(body.limit));
        params = merged;
      }
    } catch (e) {
      // body 不是 JSON 時沿用 query params
    }
  }
  const category = (params.get("category") || "").trim();
  const limitRaw = parseInt(params.get("limit") || "20", 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? 20 : limitRaw, 1), 100);
  try {
    let results = [];
    if (category) {
      results = (await env.DB.prepare(
        "SELECT id, title, summary, category, source, published_at, link FROM articles WHERE category = ? ORDER BY id DESC LIMIT ?"
      ).bind(category, limit).all()).results || [];
    } else {
      results = (await env.DB.prepare(
        "SELECT id, title, summary, category, source, published_at, link FROM articles ORDER BY id DESC LIMIT ?"
      ).bind(limit).all()).results || [];
    }
    return new Response(JSON.stringify({ ok: true, category, count: results.length, items: results }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e && e.message) || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

// ===== 翻譯快取機制 =====
const LANG_NAME_FOR_M2M100 = {
  "zh-Hans": "chinese", "en": "english", "fr": "french", "de": "german",
  "ja": "japanese", "es": "spanish", "eo": "esperanto",
};
const SOURCE_LANG_NAME_FOR_M2M100 = { "zh": "chinese", "en": "english" };

// 中文↔英文這兩個方向不走AI翻譯(例如同一部世界名著已經分別發布了中英文兩個版本,
// 不需要再機器翻譯,避免品質不佳的機器翻譯蓋過已經存在的正式版本)
function isZhEnPair(sourceLang, lang) {
  const isZhTarget = lang === "zh-Hant" || lang === "zh-Hans";
  const isEnTarget = lang === "en";
  if (sourceLang === "zh" && isEnTarget) return true;
  if (sourceLang === "en" && isZhTarget) return true;
  return false;
}

// ===== V74: 多語言回退提示輔助 =====
// 偵測文字是否仍含中文字元(判斷是否回退到中文原文)
function containsCjk(text) {
  if (!text) return false;
  return /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(String(text));
}

// 英文頁面回退提示:當 lang=en 但正文仍是中文(翻譯失敗回退)時,顯示「English version coming soon」,
// 避免訪客以為頁面壞掉;非英文頁面一律不輸出
function englishFallbackNote(lang, contentText) {
  if (lang !== "en") return "";
  if (!contentText || !containsCjk(contentText)) return "";
  return `<div class="en-fallback-note">🌐 English version coming soon — showing the original Chinese text for now.</div>`;
}

async function getOrTranslate(env, contentType, contentId, lang, field, originalText, sourceLang, bypassZhEnPair) {
  sourceLang = sourceLang || "zh";
  if (!originalText) return originalText;
  if (sourceLang === "zh" && lang === "zh-Hant") return originalText;
  if (sourceLang === "en" && lang === "en") return originalText;
  // 中英互不翻譯的規則只適用於文學作品(保留原文/人工翻譯雙版本),不應影響新聞等其他內容
  const isLiteratureType = contentType === "literature" || contentType === "literature_series";
  // V74: 世界名著等已有正式雙語版本的文學作品仍走「中英互不翻譯」;其他文學作品(原創投稿等)
  // 透過 bypassZhEnPair=true 照常翻譯,解決 /en/literature 正文不翻譯的問題
  if (!bypassZhEnPair && isLiteratureType && isZhEnPair(sourceLang, lang)) return originalText;

  // V76: 快取讀取加上容錯 — translations 表查詢失敗時視為無快取,直接走翻譯或原文回退,不讓頁面 500
  let cached = null;
  try {
    cached = await env.DB.prepare(
      "SELECT translated_text FROM translations WHERE content_type = ? AND content_id = ? AND lang = ? AND field = ?"
    ).bind(contentType, contentId, lang, field).first();
  } catch (e) {
    cached = null;
  }
  // V74: 快取內若是「非空白」的翻譯結果才採用,避免舊版失敗時殘留的空字串快取造成頁面永遠空白
  if (cached && cached.translated_text && String(cached.translated_text).trim()) return cached.translated_text;

  const isLongField = field === "content";
  let translated;

  if (isLongField && originalText.length > 400) {
    translated = await translateLongText(env, lang, originalText, sourceLang);
  } else {
    translated = await translateChunk(env, lang, originalText, 6000, sourceLang);
  }

  // V74: 平滑回退 — AI 翻譯失敗(額度用盡/模型異常/重複迴圈/翻出原文)時,回退顯示中文原文,
  // 避免英文頁面正文直接空白;且只有「真正翻譯成功」的結果才寫入快取,失敗不會污染快取
  const isRealTranslation = !!(translated && translated.trim()) && String(translated).trim() !== String(originalText).trim();
  const finalText = isRealTranslation ? translated : originalText;

  if (env && env.DB && isRealTranslation) {
    try {
      if (cached) {
        // 舊版失敗可能殘留空字串快取,覆寫為這次的成功翻譯結果
        await env.DB.prepare(
          "UPDATE translations SET translated_text = ? WHERE content_type = ? AND content_id = ? AND lang = ? AND field = ?"
        ).bind(finalText, contentType, contentId, lang, field).run();
      } else {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO translations (content_type, content_id, lang, field, translated_text) VALUES (?, ?, ?, ?, ?)"
        ).bind(contentType, contentId, lang, field, finalText).run();
      }
    } catch (e) {
      // 捕獲異常，防止頁面崩掉
    }
  }

  return finalText;
}

// V76-3: 已移除「DAILY_TRANSLATE_CAP 每日計數上限」。
// 這類按 debug_log 統計次數的硬性限制,會被搜尋引擎蜘蛛/爬蟲(Googlebot/Bingbot/GPTBot/Ahrefs 等)
// 訪問英文頁時刷爆,誤把正常真人用戶的翻譯降級成「English version coming soon」。
// 現在只在 Workers AI 真正回傳額度/頻率限制(4006/429/rate limit/quota)時才降級,其餘一律正常翻譯。

// 偵測AI翻譯輸出是否卡進重複迴圈(例如同一片語連續出現數十次),
// 這是m2m100模型偶發的已知故障模式,偵測到就視為失敗結果,不採用
function isDegenerateRepetition(text) {
  if (!text || text.length < 40) return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 8) return false;
  // 檢查是否有連續4個詞的片語重複出現4次以上
  const phraseLen = 4;
  const counts = {};
  for (let i = 0; i <= words.length - phraseLen; i++) {
    const phrase = words.slice(i, i + phraseLen).join(" ").toLowerCase();
    counts[phrase] = (counts[phrase] || 0) + 1;
    if (counts[phrase] >= 4) return true;
  }
  return false;
}

// ===== V76-4: DeepL 備援翻譯(當 Workers AI 失敗/額度用盡時自動啟用) =====
// 需在 Cloudflare 環境變數設定 DEEPL_API_KEY(免費或Pro皆可,兩個端點自動輪詢)
const DEEPL_LANG_MAP = {
  "en": "EN", "zh-Hant": "ZH-HANT", "zh-Hans": "ZH-HANS",
  "fr": "FR", "de": "DE", "ja": "JA", "es": "ES",
  "ko": "KO", "it": "IT", "pt": "PT-PT", "ru": "RU",
};
async function translateWithDeepL(env, text, lang, sourceLang) {
  const apiKey = env && env.DEEPL_API_KEY;
  if (!apiKey) return "";
  const target = DEEPL_LANG_MAP[lang];
  if (!target) return "";
  const payload = { text: [text], target_lang: target };
  if (sourceLang === "zh") payload.source_lang = "ZH";
  const endpoints = [
    "https://api-free.deepl.com/v2/translate",
    "https://api.deepl.com/v2/translate",
  ];
  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": "DeepL-Auth-Key " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const body = (await resp.text().catch(() => "")).slice(0, 200);
        console.error("DeepL API Error:", resp.status, body); // V76-4: 真實錯誤日誌
        if (resp.status === 403 || resp.status === 404) continue; // 端點不適用(免費key vs Pro key),換下一個
        return ""; // 400/429 等其他錯誤:直接放棄,交給上層回退
      }
      const data = await resp.json();
      const out = data && data.translations && data.translations[0] && data.translations[0].text;
      if (out && out.trim()) return out.trim();
      console.error("DeepL empty result for lang=" + lang);
      return "";
    } catch (err) {
      console.error("DeepL Error:", err && err.message ? err.message : err); // V76-4: 真實錯誤日誌
      // 網絡錯誤:嘗試下一個端點
    }
  }
  return "";
}

async function translateChunk(env, lang, text, maxTokens, sourceLang, retriesLeft = 2) {
  const targetLangName = LANG_NAME_FOR_M2M100[lang];
  const sourceLangName = SOURCE_LANG_NAME_FOR_M2M100[sourceLang] || "chinese";
  if (!targetLangName) return "";

  // V76-3: 爬蟲/搜尋引擎蜘蛛(Googlebot/Bingbot/GPTBot/Ahrefs/Yandex/Baiduspider 等)
  // 訪問未翻譯的英文頁面時,一律直接回傳空字串(上層會回退中文原文或讀取既有快取),
  // 絕對禁止觸發翻譯 AI,避免爬蟲刷爆額度。request 由 fetch 入口掛在 env.__request 上
  const curReq = (env && env.__request) || null;
  if (curReq && isBotRequest(curReq)) return "";

  try {
    const aiResp = await env.AI.run("@cf/meta/m2m100-1.2b", {
      text: text.slice(0, 1000),
      source_lang: sourceLangName,
      target_lang: targetLangName,
    });
    const result = (aiResp && (aiResp.translated_text || aiResp.result?.translated_text || aiResp.response)) || "";
    await logDebug(env, "m2m100_result", JSON.stringify({
      textLen: text.length, lang, resultLen: (result || "").length,
      raw: JSON.stringify(aiResp).slice(0, 200),
    }));
    if (result && result.trim() && !isDegenerateRepetition(result)) return result.trim();
    if (result && isDegenerateRepetition(result)) {
      await logDebug(env, "m2m100_degenerate", JSON.stringify({ textLen: text.length, lang }));
    }
  } catch (e) {
    const errMsg = String(e && e.message ? e.message : e);
    console.error("Translation Error (Workers AI):", errMsg); // V76-4: 真實錯誤日誌,可在 Cloudflare Logs 排查
    await logDebug(env, "m2m100_error", JSON.stringify({ textLen: text.length, lang, error: errMsg.slice(0, 300) }));
    // V76-3: 只有「真正額度/頻率超限」才視為額度用盡、直接降級不再重試:
    // 4006 = Workers AI 每日/每月額度上限,429 / rate limit / quota = 頻率限制;
    // JSON 解析失敗、網絡微小波動等暫時性錯誤不屬於額度用盡,會進入下方重試(最多2次)
    const quotaLike = /4006|429|rate\s*limit|quota|limit\s*exceeded/i.test(errMsg);
    if (quotaLike) {
      // V76-4: 額度用盡不重試;若設定 DEEPL_API_KEY,則嘗試 DeepL 備援翻譯
      const deeplOut = await translateWithDeepL(env, text.slice(0, 5000), lang, sourceLang);
      if (deeplOut) return deeplOut;
      return "";
    }
  }
  if (retriesLeft > 0) {
    return translateChunk(env, lang, text, maxTokens, sourceLang, retriesLeft - 1);
  }
  // V76-4: 重試耗盡後,若設定 DEEPL_API_KEY,則嘗試 DeepL 備援翻譯
  const deeplOut = await translateWithDeepL(env, text.slice(0, 5000), lang, sourceLang);
  if (deeplOut) return deeplOut;
  return "";
}

async function logDebug(env, step, detail) {
  try {
    await env.DB.prepare("INSERT INTO debug_log (step, detail) VALUES (?, ?)").bind(step, detail).run();
  } catch (e) {}
}

function extractAiText2(aiResp) {
  if (!aiResp) return "";
  if (typeof aiResp.response === "string" && aiResp.response.trim()) return aiResp.response.trim();
  const msg = aiResp.choices && aiResp.choices[0] && aiResp.choices[0].message;
  if (msg && typeof msg.content === "string" && msg.content.trim()) return msg.content.trim();
  // 注意:故意不使用 reasoning(思考過程)欄位當備援,那不是正式的評論結果
  return "";
}

// 常見搜尋引擎/SEO爬蟲的 User-Agent 關鍵字,這些請求略過AI評論生成(不影響收錄,
// 因為 noindex 已經拿掉了,爬蟲一樣看得到頁面,只是暫時沒有評論,等真人訪客造訪時才會補上)
const BOT_UA_PATTERNS = [
  "bot", "spider", "crawl", "slurp", "bingpreview", "facebookexternalhit",
  "ahrefs", "semrush", "mj12bot", "dotbot", "gptbot", "ccbot", "claudebot",
  "petalbot", "yandex", "baiduspider",
];

function isBotRequest(request) {
  const ua = (request && request.headers.get("User-Agent") || "").toLowerCase();
  if (!ua) return true; // 沒有 UA 的請求也視為非真人,保守處理
  return BOT_UA_PATTERNS.some((p) => ua.includes(p));
}

// 每日AI評論生成次數上限,避免短時間內大量頁面被訪問時瞬間耗盡Workers AI每日免費額度,
// 進而連累翻譯功能(m2m100)一起失敗。上限抓保守值,把大部分額度留給翻譯使用。
const DAILY_COMMENT_GEN_CAP = 60;

// V76: 每日評論生成計數查詢加上容錯,查詢失敗時視為已達上限,停止生成(避免消耗AI額度)
async function commentGenCountToday(env) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM debug_log WHERE step = 'comment_gen_result' AND date(created_at) = ?"
    ).bind(today).first();
    return (row && row.c) || 0;
  } catch (e) {
    return DAILY_COMMENT_GEN_CAP;
  }
}

// 若文章沒有人工編輯評論,即時用 AI 生成一段簡短評論並寫回資料庫快取,
// 目的是讓新聞詳情頁不再需要靠 noindex 排除在搜尋引擎收錄之外
async function getOrGenerateComment(env, row, request) {
  if (row.editor_comment && row.editor_comment.trim()) return row.editor_comment;
  if (isBotRequest(request)) return "";

  const countToday = await commentGenCountToday(env);
  if (countToday >= DAILY_COMMENT_GEN_CAP) return "";

  const prompt = `你是一位新聞編輯,請針對以下新聞用繁體中文寫一段2到3句話的簡短編輯評論或背景補充,不要重複新聞標題本身的文字,不要加任何前言、標籤或引號,直接輸出評論內容:\n\n標題:${row.title}\n摘要:${row.summary || ""}`;

  try {
    const aiResp = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
    });
    const comment = extractAiText2(aiResp);
    await logDebug(env, "comment_gen_result", JSON.stringify({
      id: row.id, resultLen: (comment || "").length, raw: JSON.stringify(aiResp).slice(0, 200),
    }));
    if (comment) {
      await env.DB.prepare("UPDATE articles SET editor_comment = ? WHERE id = ?").bind(comment, row.id).run();
      return comment;
    }
  } catch (e) {
    await logDebug(env, "comment_gen_error", JSON.stringify({ id: row.id, error: e.message }));
  }
  return "";
}

// 摘要擴充功能只套用於此ID之後的新文章,780篇舊文完全不動(2026-07-28上線時的最大id)
const SUMMARY_EXPAND_CUTOFF_ID = 2849;
const DAILY_SUMMARY_EXPAND_CAP = 60;
const SUMMARY_EXPAND_MIN_LEN = 150; // 摘要短於此長度才擴充,已經夠長的不動

// V76: 每日摘要擴充計數查詢加上容錯,查詢失敗時視為已達上限,停止擴充(避免消耗AI額度)
async function summaryExpandCountToday(env) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM debug_log WHERE step = 'summary_expand_result' AND date(created_at) = ?"
    ).bind(today).first();
    return (row && row.c) || 0;
  } catch (e) {
    return DAILY_SUMMARY_EXPAND_CAP;
  }
}

// 只對新文章(id > SUMMARY_EXPAND_CUTOFF_ID)且摘要偏短時,即時擴充成100~200字(核心事件+人物機構+背景),
// 寫回資料庫快取,下次造訪同一篇直接讀快取不重複呼叫AI
async function getOrExpandSummary(env, row, request) {
  const original = row.summary || "";
  if (row.id <= SUMMARY_EXPAND_CUTOFF_ID) return original;
  // 摘要=標題的問題橫跨所有分類,不再限制特定分類,靠每日上限(60次)控制成本
  if (original.length >= SUMMARY_EXPAND_MIN_LEN) return original;
  if (isBotRequest(request)) return original;

  const countToday = await summaryExpandCountToday(env);
  if (countToday >= DAILY_SUMMARY_EXPAND_CAP) return original;

  const prompt = `你是一位新聞編輯,請針對以下新聞用繁體中文寫一段100到200字的摘要,內容需包含:核心事件、涉及人物或機構、重要背景。不要加任何前言、標籤或引號,直接輸出摘要內容:\n\n標題:${row.title}\n原始摘要:${original}`;

  try {
    const aiResp = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 400,
    });
    const expanded = extractAiText2(aiResp);
    await logDebug(env, "summary_expand_result", JSON.stringify({
      id: row.id, resultLen: (expanded || "").length, raw: JSON.stringify(aiResp).slice(0, 200),
    }));
    if (expanded && expanded.trim()) {
      await env.DB.prepare("UPDATE articles SET summary = ? WHERE id = ?").bind(expanded.trim(), row.id).run();
      return expanded.trim();
    }
  } catch (e) {
    await logDebug(env, "summary_expand_error", JSON.stringify({ id: row.id, error: e.message }));
  }
  return original;
}

async function translateLongText(env, lang, originalText, sourceLang) {
  let units = originalText.split(/\n+/).filter((p) => p.trim());
  if (units.length <= 1) {
    const matched = originalText.match(/[^。!?;.\n]+[。!?;.]?/g);
    units = matched ? matched.filter((s) => s.trim()) : [originalText];
  }

  const groups = [];
  let current = [];
  let currentLen = 0;
  for (const u of units) {
    if (currentLen + u.length > 400 && current.length > 0) {
      groups.push(current.join(""));
      current = [];
      currentLen = 0;
    }
    current.push(u);
    currentLen += u.length;
  }
  if (current.length > 0) groups.push(current.join(""));

  const finalGroups = [];
  for (const g of groups) {
    const result = await translateChunk(env, lang, g, 3000, sourceLang);
    finalGroups.push(result && result.trim() ? result : g);
  }
  return finalGroups.join("\n\n");
}

// ===== V76-2: 標籤保留式 HTML 翻譯(政策/方案等含標籤正文專用) =====
// 把 HTML 拆成「標籤」與「可見文字」片段,只翻譯可見文字片段,標籤原樣保留,
// 避免把整段 HTML 丟給 AI 造成標籤損毀;片段翻譯失敗(額度用盡/模型異常/重複迴圈)時回退原文,
// 永不空白、永不崩潰;翻譯結果以 (contentType, contentId, lang, "content_html") 寫入 D1 translations 快取,
// 快取鍵已含 lang,英文與中文請求互不干擾
async function translateHtmlPreservingTags(env, contentType, contentId, lang, html) {
  if (lang === "zh-Hant") return html;
  if (!html) return html;
  let cached = null;
  try {
    cached = await env.DB.prepare(
      "SELECT translated_text FROM translations WHERE content_type = ? AND content_id = ? AND lang = ? AND field = ?"
    ).bind(contentType, contentId, lang, "content_html").first();
  } catch (e) { cached = null; }
  if (cached && cached.translated_text && String(cached.translated_text).trim()) return cached.translated_text;

  const parts = String(html).split(/(<[^>]+>)/g);
  let inProtected = false; // <script>/<style>/<textarea> 內的內容不翻譯
  let anySuccess = false;
  let out = "";
  for (const part of parts) {
    if (!part) continue;
    if (/^<[^>]+>$/.test(part)) {
      out += part; // 標籤原樣保留
      const tag = part.toLowerCase();
      if (tag.startsWith("<script") || tag.startsWith("<style") || tag.startsWith("<textarea")) inProtected = true;
      else if (tag.startsWith("</")) inProtected = false;
      continue;
    }
    if (inProtected) { out += part; continue; }
    const trimmed = part.trim();
    if (!trimmed || (!/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(trimmed) && !/[a-zA-Z]{2,}/.test(trimmed))) {
      out += part; // 純空白/數字/標點片段不翻譯,節省AI額度
      continue;
    }
    let translated = "";
    try {
      translated = trimmed.length > 400
        ? await translateLongText(env, lang, trimmed, "zh")
        : await translateChunk(env, lang, trimmed, 6000, "zh");
    } catch (e) { translated = ""; }
    if (translated && translated.trim()) { out += translated; anySuccess = true; }
    else { out += part; } // 片段翻譯失敗,回退原文
  }
  if (anySuccess && env && env.DB) {
    try {
      if (cached) {
        await env.DB.prepare("UPDATE translations SET translated_text = ? WHERE content_type = ? AND content_id = ? AND lang = ? AND field = ?")
          .bind(out, contentType, contentId, lang, "content_html").run();
      } else {
        await env.DB.prepare("INSERT OR IGNORE INTO translations (content_type, content_id, lang, field, translated_text) VALUES (?, ?, ?, ?, ?)")
          .bind(contentType, contentId, lang, "content_html", out).run();
      }
    } catch (e) {}
  }
  return out;
}

async function mapWithConcurrency(items, batchSize, fn) {
  const results = new Array(items.length);
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((item, idx) => fn(item, i + idx)));
    batchResults.forEach((r, idx) => { results[i + idx] = r; });
  }
  return results;
}

// ===== 語言包 =====
const I18N = {
  "zh-Hant": {
    "site_name": "SY Horizon / SY 視野", "tagline": "多元視野,追蹤世界",
    "nav_home": "首頁", "nav_news": "新聞追蹤", "nav_literature": "文學作品", "nav_media": "多媒體",
    "nav_tools": "工具下載", "nav_guide": "避坑指南", "nav_about": "關於我們",
    "placeholder_wip": "內容建置中", "lit_page_title": "文學作品", "lit_page_subtitle": "世界名著、原創投稿、各抒己見",
    "lit_standalone": "單篇作品", "lit_back": "返回文學作品列表", "lit_author": "作者", "lit_category": "分類",
    "lit_all": "全部", "news_source": "來源", "news_no_data": "目前沒有資料", "footer_author": "作者介紹", "footer_privacy": "隱私政策", "footer_contact": "聯絡我們",
    // ===== V75: Tools / Free / Media 靜態文字字典(繁體中文) =====
    "premium_tools": "付費工具",
    "premium_card_name": "海外生活通 🔒",
    "premium_card_desc": "為海外生活、跨國移居人士設計的實用工具：官方文書與信件起草、當地詐騙與風險快查、海外超市比價、本地生活急救問答。7天免費試用。",
    "premium_card_cta": "查看方案並開通 →",
    "grp_life": "生活小幫手",
    "grp_office": "辦公小助手",
    "grp_writing": "寫作與閱讀",
    "tool_unit_converter_name": "生活常用單位換算小工具",
    "tool_unit_converter_desc": "支援長度、重量、溫度、面積等常用單位互相換算,輸入數值自動即時計算,可下載到本地離線使用。",
    "tool_media_downloader_name": "影片一鍵下載工具",
    "tool_media_downloader_desc": "貼上YouTube、TikTok、Instagram等平台的影片網址,一鍵取得無浮水印下載連結與文案。",
    "tool_bookmark_cleaner_name": "網址收藏夾一鍵清理與管理工具",
    "tool_bookmark_cleaner_desc": "上傳瀏覽器匯出的書籤檔案,即可解析出所有收藏網址,勾選批次刪除後再匯出乾淨的新書籤檔案。",
    "tool_url_shortener_name": "本地網址對應與管理工具",
    "tool_url_shortener_desc": "自訂好記的短代號對應完整長網址,儲存在瀏覽器本地,方便快速查找與訪問常用連結。",
    "tool_word_counter_name": "Markdown 文本字數與閱讀時間統計器",
    "tool_word_counter_desc": "貼上文章內容即時計算總字數與純中文字數,並依中文閱讀速度估算預估閱讀時間。",
    "tool_tc_sc_converter_name": "繁簡體中文線上轉換工具",
    "tool_tc_sc_converter_desc": "貼上文字一鍵在繁體與簡體中文之間互轉,轉換結果可直接複製到剪貼簿。",
    "tool_text_to_speech_name": "文字轉語音與朗讀預覽小幫手",
    "tool_text_to_speech_desc": "輸入文字後可選擇發音人與朗讀速度,直接聆聽朗讀效果,適合校對文章或製作有聲內容前的預覽。",
    "free_tools_title": "免費小工具",
    "rec_tools_title": "創作工具推薦",
    "open_tool": "開啟工具 →",
    "visit_site": "點擊前往官方網站 →",
    "tools_meta_desc": "免費線上小工具：單位換算、書籤清理、字數統計、繁簡轉換、文字轉語音等實用工具。",
    "trial_banner_paid": "<strong>✔ 已開通付費工具權限</strong>，感謝您的支持！",
    "trial_banner_active": "<strong>新用戶享 7 天付費工具免費試用</strong> — 您目前已登入，試用期剩餘 <strong>{days}</strong> 天，可直接使用下方付費工具。",
    "trial_banner_login": "<strong>新用戶享 7 天付費工具免費試用</strong> — {login_link} 後即可立即體驗付費工具。",
    "trial_banner_expired": "<strong>您的 7 天免費試用已結束</strong> — 如需繼續使用付費工具，請 {pricing_link}。",
    "login_label": "登錄/註冊",
    "pricing_link_label": "查看付費方案",
    "free_page_title": "隨意逛 - 免費內容",
    "free_h1": "隨意逛",
    "free_all_badge": "全部免費",
    "free_intro": "以下內容完全免費，不需要註冊或付費即可閱讀、觀看或下載。",
    "free_meta_desc": "SY Horizon 上所有完全免費、不需要註冊或付費即可閱讀與下載的內容整理。",
    "free_browse_literature": "瀏覽所有文學作品 →",
    "free_lit_note": "（世界名著、原創投稿、報告文學，全部免費閱讀）",
    "free_browse_news": "瀏覽所有新聞 →",
    "free_news_note": "（時事、科技動態、焦點新聞、金融、奇聞異事）",
    "free_browse_guide": "瀏覽避坑指南 →",
    "free_browse_media": "瀏覽多媒體內容 →",
    "media_meta_desc": "精選時事、文學朗讀、奇聞異事與生活小知識影音內容整理。",
    "rec1_desc": "對於《小案件 大悲哀》這類多回連載的紀實作品,最頭痛的不是寫作本身,而是「線索管理」——人物關係、時間軸、伏筆是否前後一致。Manuskript 的大綱視圖(Outline View)把整部作品拆成章節樹狀結構,可以在寫作時隨時切換到「角色卡」「地點卡」檢視設定,避免跨越多年的敘事出現時間錯亂。介面偏樸素,學習曲線低,半小時就能上手。缺點是中文排版偶爾需要手動調整字距,匯出格式選項也不算豐富。",
    "rec1_reason": "適合習慣先列大綱再填血肉的創作者,免費又務實。",
    "rec2_desc": "撰寫報告文學最大的工程,往往不是寫,而是「查證」——法院判決書、新聞剪報、訪談紀錄,零散資料一多就容易搞丟出處。Zotero 的瀏覽器外掛能一鍵擷取網頁資料存檔,自動記錄來源網址與擷取時間,對需要交叉比對多方說法的紀實寫作特別實用。免費版雲端儲存空間有限(300MB),資料量大時得考慮額外方案,但對個人創作者的日常需求已經足夠。",
    "rec2_reason": "深度調查寫作前期資料整理的可靠夥伴。",
    "rec3_desc": "連載小說寫多了,角色設定、地名、時間線散落在不同章節筆記裡,靠記憶很容易前後矛盾。Obsidian 最大的價值在於「雙向連結」——把每個角色、地點建成獨立筆記,久了會自然長出一張知識網絡圖。所有資料存在本機,不依賴雲端,對於處理真實案件相關的敏感資料來說,資料自主可控是一大優勢。免費版功能對個人使用已相當完整,同步功能需付費。",
    "rec3_reason": "長期累積創作素材的理想工具。",
    "rec4_desc": "像《小案件 大悲哀》這種橫跨十多年、牽涉多方當事人的真實案件,事件先後順序和人物關係常常比小說還複雜。ProcessOn 的線上流程圖工具讓人能把整起事件按時間軸拉成一張視覺化圖表,誰在什麼時間點做了什麼決定、金錢如何流動,一目了然。網頁版免安裝、即開即用是最大優點。缺點是免費版有匯出張數與雲端儲存限制,大型專案可能需要升級。",
    "rec4_reason": "動筆前用來釐清複雜案件脈絡的輔助工具。",
    // ===== V75-FIX: 付費方案(pricing)付款區塊字典 =====
    "policy_paypal_title": "線上付款（PayPal）",
    "policy_paypal_desc": "使用 PayPal 付款時，請自行輸入您選擇方案的正確金額（$0.9 / $5.7 / $38.0），付款完成後，請依照上方說明將付款截圖寄到 biz@sylogs.com 以取得兌換碼。",
    "policy_pay_now": "立即付款",
    "policy_paypal_support": "技術支持提供方：",
    "policy_crypto_title": "線上付款（加密貨幣）",
    "policy_crypto_desc": "選擇您要購買的方案，用加密貨幣直接付款。付款完成後，請將交易紀錄截圖寄到 biz@sylogs.com 以取得兌換碼。",
    "policy_plan_once": "單次使用 $0.9",
    "policy_plan_monthly": "包月方案 $5.7",
    "policy_plan_lifetime": "終身買斷 $38",
    // ===== V77: 菜鳥之友(Beginner's Hub)字典 =====
    "nav_beginners": "菜鳥之友",
    "beginners_sub_ai": "AI與加密貨幣",
    "beginners_sub_insights": "經驗之談",
    "beginners_tab_all": "全部",
    "beginners_intro": "降低探索門檻，分享實用工具、入門指引與避坑實戰經驗。",
    "beginners_meta_desc": "菜鳥之友：降低探索門檻，分享實用工具、入門指引與避坑實戰經驗。",
    "beginners_editor_note": "AI/編輯評論：",
    "beginners_comment_soon": "閱讀全文查看 AI/編輯評論",
    "beginners_read_article": "閱讀全文 →",
    "beginners_no_data": "此分類目前還沒有文章，敬請期待。",
    // ===== V78: 歡迎投稿字典 =====
    "nav_submit": "歡迎投稿",
    "submit_page_title": "歡迎投稿",
    "submit_welcome_heading": "歡迎投稿下列內容的文章：",
    "submit_welcome_p1": "1. 批評小站內容虛假並舉出證據",
    "submit_welcome_p2": "2. 各板塊可以發佈的內容，例如：新聞、文學作品、避坑指南、菜鳥之友等。",
    "submit_note_fee": "恕小站初創，財力微薄，無力付稿酬。一經發佈，即酌情給予免費獲得付費工具 1 個月至 1 年使用權之薄酬。",
    "submit_form_title": "投稿表單（直接於網頁提交，無需寄信）",
    "submit_label_name": "姓名 / 暱稱 *",
    "submit_label_email": "聯繫 Email *",
    "submit_label_title": "文章標題 *",
    "submit_label_category": "投稿板塊",
    "submit_label_content": "文章正文 / 證據說明 *",
    "submit_label_evidence": "補充證據 / 參考連結（選填）",
    "submit_placeholder_name": "如何稱呼您？",
    "submit_placeholder_email": "方便我們回覆您",
    "submit_placeholder_title": "文章標題",
    "submit_placeholder_content": "請在此貼上文章全文；若為「批評小站內容」類，請附上具體證據與出處。",
    "submit_placeholder_evidence": "可貼上 1~3 個參考連結或檔案說明",
    "submit_content_hint": "各板塊皆可投稿，例如：新聞、文學作品、避坑指南、菜鳥之友、多媒體。",
    "submit_category_news": "新聞追蹤",
    "submit_category_literature": "文學作品",
    "submit_category_guide": "避坑指南",
    "submit_category_beginners": "菜鳥之友",
    "submit_category_media": "多媒體",
    "submit_category_other": "其他",
    "submit_btn": "送出投稿",
    "submit_required": "請填寫所有必填欄位（姓名、Email、標題、正文）。",
    "submit_email_invalid": "Email 格式不正確。",
    "submit_rate_limited": "投稿過於頻繁，請稍後再試。",
    "submit_error": "送出失敗，請稍後再試。",
    "submit_ok": "✅ 投稿已收到！我們會盡快審閱，若獲採用將以 Email 通知您。",
    "submit_meta_desc": "歡迎投稿：批評指正、新聞、文學作品等，一經發佈即贈付費工具使用權。",
    "submit_go_back": "← 返回首頁"
  },
  "zh-Hans": {
    "site_name": "SY Horizon / SY 视野", "tagline": "多元视野,追踪世界",
    "nav_home": "首页", "nav_news": "新闻追踪", "nav_literature": "文学作品", "nav_media": "多媒体",
    "nav_tools": "工具下载", "nav_guide": "避坑指南", "nav_about": "关于我们",
    "placeholder_wip": "内容建置中", "lit_page_title": "文学作品", "lit_page_subtitle": "世界名著、原创投稿、各抒己见",
    "lit_standalone": "单篇作品", "lit_back": "返回文学作品列表", "lit_author": "作者", "lit_category": "分类",
    "lit_all": "全部", "news_source": "来源", "news_no_data": "目前没有数据", "footer_author": "作者介绍", "footer_privacy": "隐私政策", "footer_contact": "联络我们",
    // ===== V77: 菜鸟之友字典 =====
    "nav_beginners": "菜鸟之友",
    "beginners_sub_ai": "AI与加密货币",
    "beginners_sub_insights": "经验之谈",
    "beginners_tab_all": "全部",
    "beginners_intro": "降低探索门槛，分享实用工具、入门指引与避坑实战经验。",
    "beginners_meta_desc": "菜鸟之友：降低探索门槛，分享实用工具、入门指引与避坑实战经验。",
    "beginners_editor_note": "AI/编辑评论：",
    "beginners_comment_soon": "阅读全文查看 AI/编辑评论",
    "beginners_read_article": "阅读全文 →",
    "beginners_no_data": "此分类目前还没有文章，敬请期待。",
    // ===== V78: 欢迎投稿字典 =====
    "nav_submit": "欢迎投稿",
    "submit_page_title": "欢迎投稿",
    "submit_welcome_heading": "欢迎投稿下列内容的文章：",
    "submit_welcome_p1": "1. 批评小站内容虚假并举出证据",
    "submit_welcome_p2": "2. 各板块可以发布的内容，例如：新闻、文学作品、避坑指南、菜鸟之友等。",
    "submit_note_fee": "恕小站初创，财力微薄，无力付稿酬。一经发布，即酌情给予免费获得付费工具 1 个月至 1 年使用权之薄酬。",
    "submit_form_title": "投稿表单（直接在网页提交，无需寄信）",
    "submit_label_name": "姓名 / 昵称 *",
    "submit_label_email": "联系 Email *",
    "submit_label_title": "文章标题 *",
    "submit_label_category": "投稿板块",
    "submit_label_content": "文章正文 / 证据说明 *",
    "submit_label_evidence": "补充证据 / 参考链接（选填）",
    "submit_placeholder_name": "如何称呼您？",
    "submit_placeholder_email": "方便我们回复您",
    "submit_placeholder_title": "文章标题",
    "submit_placeholder_content": "请在此贴上文章全文；若为「批评小站内容」类，请附上具体证据与出处。",
    "submit_placeholder_evidence": "可贴上 1~3 个参考链接或文件说明",
    "submit_content_hint": "各板块皆可投稿，例如：新闻、文学作品、避坑指南、菜鸟之友、多媒体。",
    "submit_category_news": "新闻追踪",
    "submit_category_literature": "文学作品",
    "submit_category_guide": "避坑指南",
    "submit_category_beginners": "菜鸟之友",
    "submit_category_media": "多媒体",
    "submit_category_other": "其他",
    "submit_btn": "送出投稿",
    "submit_required": "请填写所有必填字段（姓名、Email、标题、正文）。",
    "submit_email_invalid": "Email 格式不正确。",
    "submit_rate_limited": "投稿过于频繁，请稍后再试。",
    "submit_error": "送出失败，请稍后再试。",
    "submit_ok": "✅ 投稿已收到！我们会尽快审阅，若获采用将以 Email 通知您。",
    "submit_meta_desc": "欢迎投稿：批评指正、新闻、文学作品等，一经发布即赠付费工具使用权。",
    "submit_go_back": "← 返回首页"
  },
  "en": {
    "site_name": "SY Horizon", "tagline": "Diverse Perspectives, Tracking the World",
    "nav_home": "Home", "nav_news": "News", "nav_literature": "Literature", "nav_media": "Media",
    "nav_tools": "Tools", "nav_guide": "Guide", "nav_about": "About",
    "placeholder_wip": "Content coming soon", "lit_page_title": "Literature", "lit_page_subtitle": "Classics, Original Submissions, Opinions",
    "lit_standalone": "Standalone Works", "lit_back": "Back to Literature", "lit_author": "Author", "lit_category": "Category",
    "lit_all": "All", "news_source": "Source", "news_no_data": "No data available", "footer_author": "About the Author", "footer_privacy": "Privacy Policy", "footer_contact": "Contact Us",
    // ===== V75: Tools / Free / Media 靜態文字字典(英文) =====
    "premium_tools": "Premium Tools",
    "premium_card_name": "GlobalEase Overseas Life Assistant 🔒",
    "premium_card_desc": "A practical toolkit for expats and cross-border residents: official document & letter drafting, local scam and risk quick-check, overseas supermarket price comparisons, and everyday-life emergency Q&A. 7-day free trial.",
    "premium_card_cta": "View plans & activate →",
    "grp_life": "Life Utilities",
    "grp_office": "Office Helpers",
    "grp_writing": "Writing & Reading",
    "tool_unit_converter_name": "Unit Converter",
    "tool_unit_converter_desc": "Convert length, weight, temperature, area and other common units instantly. Works offline after saving to your device.",
    "tool_media_downloader_name": "Video Downloader",
    "tool_media_downloader_desc": "Paste a YouTube, TikTok or Instagram video URL to get a watermark-free download link and caption in one click.",
    "tool_bookmark_cleaner_name": "Bookmark Cleaner & Manager",
    "tool_bookmark_cleaner_desc": "Upload an exported browser bookmark file, parse every saved URL, batch-delete the ones you pick, and export a clean new file.",
    "tool_url_shortener_name": "Local URL Shortener & Manager",
    "tool_url_shortener_desc": "Map memorable short aliases to long URLs, stored locally in your browser for fast lookups and quick access.",
    "tool_word_counter_name": "Markdown Word Counter & Reading Time",
    "tool_word_counter_desc": "Paste your text to instantly count total words and Chinese characters, with an estimated reading time based on Chinese reading speed.",
    "tool_tc_sc_converter_name": "Traditional ↔ Simplified Chinese Converter",
    "tool_tc_sc_converter_desc": "Convert text between Traditional and Simplified Chinese in one click, ready to copy to your clipboard.",
    "tool_text_to_speech_name": "Text-to-Speech & Read-Aloud Preview",
    "tool_text_to_speech_desc": "Type your text, pick a voice and speed, and listen to a preview — great for proofreading or preparing audio content.",
    "free_tools_title": "Free Tools",
    "rec_tools_title": "Recommended Writing Tools",
    "open_tool": "Open Tool →",
    "visit_site": "Visit Official Site →",
    "tools_meta_desc": "Free online tools: unit converter, bookmark cleaner, word counter, traditional-simplified converter, text-to-speech and more.",
    "trial_banner_paid": "<strong>✔ Premium access activated</strong> — thank you for your support!",
    "trial_banner_active": "<strong>New users enjoy a 7-day free trial of premium tools</strong> — you are logged in with <strong>{days} day(s)</strong> left. You can use the premium tool below right now.",
    "trial_banner_login": "<strong>New users enjoy a 7-day free trial of premium tools</strong> — {login_link} to try the premium tool instantly.",
    "trial_banner_expired": "<strong>Your 7-day free trial has ended</strong> — {pricing_link} to continue using premium tools.",
    "login_label": "Log in / Sign up",
    "pricing_link_label": "view plans",
    "free_page_title": "Browse Free — Free Content",
    "free_h1": "Browse Freely",
    "free_all_badge": "All Free",
    "free_intro": "Everything below is completely free — no registration or payment required to read, watch or download.",
    "free_meta_desc": "A roundup of all completely free content on SY Horizon that can be read and downloaded without registration or payment.",
    "free_browse_literature": "Browse all literature →",
    "free_lit_note": " (World classics, original submissions and reportage — all free to read)",
    "free_browse_news": "Browse all news →",
    "free_news_note": " (Current affairs, tech, spotlight, finance and curiosities)",
    "free_browse_guide": "Browse all guides →",
    "free_browse_media": "Browse media content →",
    "media_meta_desc": "Curated videos covering current affairs, literature readings, curiosities and everyday life tips.",
    "rec1_desc": "For serialized non-fiction works like this one, the biggest challenge isn't writing itself — it's 'thread management': keeping characters, timelines and foreshadowing consistent. Manuskript's Outline View breaks your whole book into a chapter tree, letting you switch to character cards and location cards anytime while writing, avoiding timeline confusion across years of narrative. The interface is plain, the learning curve is low, and you can get started in half an hour. The downside: Chinese typography occasionally needs manual spacing adjustments, and export options are limited.",
    "rec1_reason": "A free and pragmatic choice for creators who like to outline first, then fill in the details.",
    "rec2_desc": "The hardest part of writing reportage is often not the writing, but verification — court rulings, news clippings and interview notes pile up quickly and sources get lost. Zotero's browser extension captures web pages with one click, automatically recording source URLs and capture time — especially useful for investigative writing that cross-checks multiple accounts. The free cloud storage is limited (300MB), so heavy data users may need a paid plan, but it's enough for individual creators' daily needs.",
    "rec2_reason": "A reliable companion for organizing research materials in the early stages of in-depth investigative writing.",
    "rec3_desc": "Write enough serialized fiction and character settings, place names and timelines get scattered across chapter notes — relying on memory leads to contradictions. Obsidian's greatest value is 'bidirectional links': build a note for every character and place, and over time a knowledge network naturally grows. All data stays local, no cloud dependency — a big advantage for handling sensitive material related to real cases, since you keep full control of your data. The free tier is quite complete for personal use; sync requires payment.",
    "rec3_reason": "The ideal tool for accumulating creative material over the long term.",
    "rec4_desc": "For a real case spanning more than a decade with many parties involved, the sequence of events and relationships can be more complex than fiction. ProcessOn's online flowchart tool lets you lay the whole case out on a timeline as a visual diagram — who made what decision when, and how money flowed, at a glance. No installation needed, web-based and ready to use instantly. The downside: the free tier limits exports and cloud storage, and large projects may require an upgrade.",
    "rec4_reason": "A supporting tool for clarifying complex case threads before you start writing.",
    // ===== V75-FIX: 付費方案(pricing)付款區塊字典 =====
    "policy_paypal_title": "Online Payment (PayPal)",
    "policy_paypal_desc": "When paying with PayPal, please enter the exact amount of your chosen plan ($0.9 / $5.7 / $38.0). After payment, send a screenshot of the transaction to biz@sylogs.com as described above to receive your redemption code.",
    "policy_pay_now": "Pay Now",
    "policy_paypal_support": "Payments powered by:",
    "policy_crypto_title": "Online Payment (Cryptocurrency)",
    "policy_crypto_desc": "Choose the plan you want and pay directly with cryptocurrency. After payment, send a screenshot of the transaction to biz@sylogs.com to receive your redemption code.",
    "policy_plan_once": "Single Use — $0.9",
    "policy_plan_monthly": "Monthly Plan — $5.7",
    "policy_plan_lifetime": "Lifetime License — $38",
    // ===== V76-4: Pricing 固定頁靜態英文內容(100%秒開英文,不依賴AI/DeepL,永不觸發降級提示) =====
    "pricing_title": "GlobalEase - Pricing Plans",
    "pricing_content_html": "<h2>Pricing Plans</h2>\n<p>GlobalEase — the Overseas Life Assistant — is a premium toolkit for overseas life and cross-border relocation. Choose the plan that fits you best:</p>\n<ul>\n<li><strong>Single Use — $0.9:</strong> unlock all premium tools once for one-time use.</li>\n<li><strong>Monthly Plan — $5.7:</strong> unlimited use for one month.</li>\n<li><strong>Lifetime License — $38:</strong> pay once, use forever.</li>\n</ul>\n<h2>How to Get Your Redemption Code</h2>\n<p>Pay via PayPal or cryptocurrency using the buttons below. After payment, send your payment screenshot to <a href=\"mailto:biz@sylogs.com\">biz@sylogs.com</a> and you will receive a redemption code, usually within 24 hours.</p>\n<h2>How to Redeem</h2>\n<p>Enter your redemption code on the <a href=\"/redeem\">redeem page</a> to activate premium access.</p>",
    // ===== V77: Beginner's Hub dictionary =====
    "nav_beginners": "Beginner's Hub",
    "beginners_sub_ai": "AI & Crypto",
    "beginners_sub_insights": "Practical Insights",
    "beginners_tab_all": "All",
    "beginners_intro": "Lower the barrier to exploration — practical tools, getting-started guides, and hard-won lessons from real experience.",
    "beginners_meta_desc": "Beginner's Hub: practical tools, getting-started guides, and hard-won lessons from real experience.",
    "beginners_editor_note": "AI / Editor's Note: ",
    "beginners_comment_soon": "Read the full article to see the AI / editor's note",
    "beginners_read_article": "Read full article →",
    "beginners_no_data": "No articles in this category yet — stay tuned.",
    // ===== V78: Welcome Submissions dictionary =====
    "nav_submit": "Submit",
    "submit_page_title": "Welcome Submissions",
    "submit_welcome_heading": "We welcome submissions of the following:",
    "submit_welcome_p1": "1. Articles that point out inaccuracies in our content, with evidence.",
    "submit_welcome_p2": "2. Content for any of our sections — news, literature, guides, Beginner's Hub, and more.",
    "submit_note_fee": "This is a young site with limited resources, so we are unable to pay a cash fee. However, once your work is published, we will gladly grant you 1 month to 1 year of free access to our premium tools as a token of appreciation.",
    "submit_form_title": "Submission Form (submit directly on this page — no email needed)",
    "submit_label_name": "Name / Nickname *",
    "submit_label_email": "Contact Email *",
    "submit_label_title": "Article Title *",
    "submit_label_category": "Section",
    "submit_label_content": "Article Body / Evidence *",
    "submit_label_evidence": "Supporting evidence / reference links (optional)",
    "submit_placeholder_name": "How should we address you?",
    "submit_placeholder_email": "So we can reply to you",
    "submit_placeholder_title": "Article title",
    "submit_placeholder_content": "Paste the full article here; for critical submissions, please include specific evidence and sources.",
    "submit_placeholder_evidence": "1–3 reference links or file notes",
    "submit_content_hint": "All sections are welcome — news, literature, guides, Beginner's Hub, media, and more.",
    "submit_category_news": "News",
    "submit_category_literature": "Literature",
    "submit_category_guide": "Guides",
    "submit_category_beginners": "Beginner's Hub",
    "submit_category_media": "Media",
    "submit_category_other": "Other",
    "submit_btn": "Submit",
    "submit_required": "Please fill in all required fields (name, email, title, body).",
    "submit_email_invalid": "Invalid email format.",
    "submit_rate_limited": "Too many submissions — please try again later.",
    "submit_error": "Submission failed — please try again later.",
    "submit_ok": "✅ Submission received! We'll review it soon and email you if it's accepted.",
    "submit_meta_desc": "Welcome submissions: critiques with evidence, news, literature and more — contributors receive free premium tool access once published.",
    "submit_go_back": "← Back to Home"
  },
  "fr": {
    "site_name": "SY Horizon", "tagline": "Perspectives Diverses, Suivre le Monde",
    "nav_home": "Accueil", "nav_news": "Actualités", "nav_literature": "Littérature", "nav_media": "Médias",
    "nav_tools": "Outils", "nav_guide": "Guide", "nav_about": "À propos",
    "placeholder_wip": "Contenu à venir", "lit_page_title": "Littérature", "lit_page_subtitle": "Classiques, Soumissions originales, Opinions",
    "lit_standalone": "Œuvres indépendantes", "lit_back": "Retour à la littérature", "lit_author": "Auteur", "lit_category": "Catégorie",
    "lit_all": "Tous", "news_source": "Source", "news_no_data": "Aucune donnée disponible", "footer_author": "À propos de l’auteur", "footer_privacy": "Politique de confidentialité", "footer_contact": "Nous contacter",
    // ===== V77: Guide des Débutants =====
    "nav_beginners": "Guide des Débutants",
    "beginners_sub_ai": "IA et Crypto",
    "beginners_sub_insights": "Conseils Pratiques",
    "nav_submit": "Soumettre"
  },
  "de": {
    "site_name": "SY Horizon", "tagline": "Vielfältige Perspektiven, Die Welt Verfolgen",
    "nav_home": "Startseite", "nav_news": "Nachrichten", "nav_literature": "Literatur", "nav_media": "Medien",
    "nav_tools": "Werkzeuge", "nav_guide": "Leitfaden", "nav_about": "Über uns",
    "placeholder_wip": "Inhalt folgt in Kürze", "lit_page_title": "Literatur", "lit_page_subtitle": "Klassiker, Originaleinreichungen, Meinungen",
    "lit_standalone": "Einzelwerke", "lit_back": "Zurück zur Literatur", "lit_author": "Autor", "lit_category": "Kategorie",
    "lit_all": "Alle", "news_source": "Quelle", "news_no_data": "Keine Daten verfügbar", "footer_author": "Über den Autor", "footer_privacy": "Datenschutz", "footer_contact": "Kontakt",
    // ===== V77: Anfänger-Hub =====
    "nav_beginners": "Anfänger-Hub",
    "beginners_sub_ai": "KI & Krypto",
    "beginners_sub_insights": "Praxiserfahrungen",
    "nav_submit": "Einreichen"
  },
  "ja": {
    "site_name": "SY Horizon", "tagline": "多様な視点で世界を追う",
    "nav_home": "ホーム", "nav_news": "ニュース", "nav_literature": "文学作品", "nav_media": "メディア",
    "nav_tools": "ツール", "nav_guide": "ガイド", "nav_about": "私たちについて",
    "placeholder_wip": "コンテンツ準備中", "lit_page_title": "文学作品", "lit_page_subtitle": "名作、オリジナル投稿、意見",
    "lit_standalone": "単独作品", "lit_back": "文学作品一覧に戻る", "lit_author": "著者", "lit_category": "カテゴリー",
    "lit_all": "すべて", "news_source": "出典", "news_no_data": "データがありません", "footer_author": "著者について", "footer_privacy": "プライバシーポリシー", "footer_contact": "お問い合わせ",
    // ===== V77: 初心者ハブ =====
    "nav_beginners": "初心者ハブ",
    "beginners_sub_ai": "AIと暗号資産",
    "beginners_sub_insights": "経験談",
    "nav_submit": "投稿"
  },
  "es": {
    "site_name": "SY Horizon", "tagline": "Perspectivas Diversas, Siguiendo el Mundo",
    "nav_home": "Inicio", "nav_news": "Noticias", "nav_literature": "Literatura", "nav_media": "Multimedia",
    "nav_tools": "Herramientas", "nav_guide": "Guía", "nav_about": "Acerca de",
    "placeholder_wip": "Contenido próximamente", "lit_page_title": "Literatura", "lit_page_subtitle": "Clásicos, Envíos originales, Opiniones",
    "lit_standalone": "Obras Independientes", "lit_back": "Volver a Literatura", "lit_author": "Autor", "lit_category": "Categoría",
    "lit_all": "Todos", "news_source": "Fuente", "news_no_data": "No hay datos disponibles", "footer_author": "Sobre el Autor", "footer_privacy": "Política de Privacidad", "footer_contact": "Contáctenos",
    // ===== V77: Centro para Principiantes =====
    "nav_beginners": "Centro para Principiantes",
    "beginners_sub_ai": "IA y Cripto",
    "beginners_sub_insights": "Experiencias Prácticas",
    "nav_submit": "Enviar"
  }
};

// ===== 分類標籤翻譯(固定分類清單,直接查表,不走AI翻譯管線) =====
const CATEGORY_LABELS = {
  "時事": { "zh-Hant": "時事", "zh-Hans": "时事", "en": "Current Affairs", "fr": "Actualités", "de": "Zeitgeschehen", "ja": "時事", "eo": "Aktualaĵoj", "es": "Actualidad" },
  "科技動態": { "zh-Hant": "科技動態", "zh-Hans": "科技动态", "en": "Tech News", "fr": "Technologie", "de": "Technik-News", "ja": "テクノロジー", "eo": "Teknologiaj Novaĵoj", "es": "Tecnología" },
  "焦點新聞": { "zh-Hant": "焦點新聞", "zh-Hans": "焦点新闻", "en": "Spotlight", "fr": "À la une", "de": "Im Fokus", "ja": "注目ニュース", "eo": "Elstaraj Novaĵoj", "es": "Destacado" },
  "金融": { "zh-Hant": "金融", "zh-Hans": "金融", "en": "Finance", "fr": "Finance", "de": "Finanzen", "ja": "金融", "eo": "Financo", "es": "Finanzas" },
  "奇聞異事": { "zh-Hant": "奇聞異事", "zh-Hans": "奇闻异事", "en": "Curiosities", "fr": "Faits Insolites", "de": "Kuriositäten", "ja": "奇妙な話", "eo": "Strangaĵoj", "es": "Curiosidades" },
  "世界名著": { "zh-Hant": "世界名著", "zh-Hans": "世界名著", "en": "World Classics", "fr": "Classiques Mondiaux", "de": "Weltliteratur", "ja": "世界名作", "eo": "Mondaj Klasikaĵoj", "es": "Clásicos Universales" },
  "原創投稿": { "zh-Hant": "原創投稿", "zh-Hans": "原创投稿", "en": "Original Submissions", "fr": "Soumissions Originales", "de": "Originalbeiträge", "ja": "オリジナル投稿", "eo": "Originalaj Kontribuoj", "es": "Envíos Originales" },
  "各抒己見": { "zh-Hant": "各抒己見", "zh-Hans": "各抒己见", "en": "Opinions", "fr": "Opinions", "de": "Meinungen", "ja": "意見", "eo": "Opinioj", "es": "Opiniones" },
  "文學作品": { "zh-Hant": "文學作品", "zh-Hans": "文学作品", "en": "Literature", "fr": "Littérature", "de": "Literatur", "ja": "文学作品", "eo": "Literaturo", "es": "Literatura" },
  "及時新聞": { "zh-Hant": "及時新聞", "zh-Hans": "及时新闻", "en": "Breaking News", "fr": "Actualités Récentes", "de": "Aktuelle Nachrichten", "ja": "最新ニュース", "eo": "Lastminutaj Novaĵoj", "es": "Noticias de Última Hora" },
  "生活小知識": { "zh-Hant": "生活小知識", "zh-Hans": "生活小知识", "en": "Life Tips", "fr": "Astuces Pratiques", "de": "Lebenstipps", "ja": "生活の知恵", "eo": "Vivaj Konsiletoj", "es": "Consejos de Vida" },
  // V77: 菜鳥之友主/子版塊分類(articles.category 直接存這些值,catLabel 統一翻譯)
  "菜鳥之友": { "zh-Hant": "菜鳥之友", "zh-Hans": "菜鸟之友", "en": "Beginner's Hub", "fr": "Guide des Débutants", "de": "Anfänger-Hub", "ja": "初心者ハブ", "eo": "Komencanta Centro", "es": "Centro para Principiantes" },
  "AI與加密貨幣": { "zh-Hant": "AI與加密貨幣", "zh-Hans": "AI与加密货币", "en": "AI & Crypto", "fr": "IA et Crypto", "de": "KI & Krypto", "ja": "AIと暗号資産", "eo": "AI kaj Kripto", "es": "IA y Cripto" },
  "經驗之談": { "zh-Hant": "經驗之談", "zh-Hans": "经验之谈", "en": "Practical Insights", "fr": "Conseils Pratiques", "de": "Praxiserfahrungen", "ja": "経験談", "eo": "Praktikaj Konsiloj", "es": "Experiencias Prácticas" },
};

function catLabel(lang, cat) {
  if (!cat) return "";
  const entry = CATEGORY_LABELS[cat];
  if (!entry) return cat;
  return entry[lang] || entry["zh-Hant"] || cat;
}

const LANG_CODES = Object.keys(I18N);

function t(lang, key) {
  return (I18N[lang] && I18N[lang][key]) || I18N["zh-Hant"][key] || key;
}

function langPrefix(lang) {
  return lang === "zh-Hant" ? "" : "/" + lang;
}

function parseLang(pathname) {
  const parts = pathname.split("/");
  const maybeLang = parts[1];
  if (maybeLang && LANG_CODES.includes(maybeLang) && maybeLang !== "zh-Hant") {
    const rest = "/" + parts.slice(2).join("/");
    return { lang: maybeLang, remainder: rest === "/" ? "/" : rest.replace(/\/$/, "") || "/" };
  }
  return { lang: "zh-Hant", remainder: pathname === "" ? "/" : pathname };
}

function buildNav(lang, remainder) {
  const prefix = langPrefix(lang);
  const FREE_LABEL = { "zh-Hant": "隨意逛", "zh-Hans": "随意逛", "en": "Free Content", "fr": "Contenu Gratuit", "de": "Kostenlos", "ja": "無料コンテンツ", "eo": "Senpaga Enhavo", "es": "Contenido Gratis" };
  const LOGIN_LABEL = { "zh-Hant": "登錄/註冊", "zh-Hans": "登录/注册", "en": "Login / Sign Up", "fr": "Connexion", "de": "Anmelden", "ja": "ログイン", "eo": "Ensaluti", "es": "Iniciar Sesión" };
  const navItems = [
    { key: "nav_home", path: "/" },
    { key: "nav_news", path: "/news" },
    { key: "nav_literature", path: "/literature" },
    { key: "nav_media", path: "/media" },
    { key: "nav_tools", path: "/tools" },
    { key: "nav_guide", path: "/guide" },
    { key: "nav_about", path: "/about" },
  ];
  const BEGINNERS_LABEL = { "zh-Hant": "菜鳥之友", "zh-Hans": "菜鸟之友", "en": "Beginner's Hub", "fr": "Guide des Débutants", "de": "Anfänger-Hub", "ja": "初心者ハブ", "eo": "Komencanta Centro", "es": "Centro para Principiantes" };
  const BEGINNERS_SUB1 = { "zh-Hant": "AI與加密貨幣", "zh-Hans": "AI与加密货币", "en": "AI & Crypto", "fr": "IA et Crypto", "de": "KI & Krypto", "ja": "AIと暗号資産", "eo": "AI kaj Kripto", "es": "IA y Cripto" };
  const BEGINNERS_SUB2 = { "zh-Hant": "經驗之談", "zh-Hans": "经验之谈", "en": "Practical Insights", "fr": "Conseils Pratiques", "de": "Praxiserfahrungen", "ja": "経験談", "eo": "Praktikaj Konsiloj", "es": "Experiencias Prácticas" };
  // V77: 桌面版下拉選單(懸停或鍵盤 focus 顯示子版塊;觸碰裝置點擊主連結即可進 /beginners)
  const beginnersDropdown = `
    <li class="nav-dropdown">
      <a href="${prefix}/beginners" class="nav-dropdown-toggle">${escapeHtml(BEGINNERS_LABEL[lang] || BEGINNERS_LABEL["zh-Hant"])} <span class="nav-caret">▾</span></a>
      <ul class="dropdown-menu">
        <li><a href="${prefix}/beginners?tab=ai">${escapeHtml(BEGINNERS_SUB1[lang] || BEGINNERS_SUB1["zh-Hant"])}</a></li>
        <li><a href="${prefix}/beginners?tab=insights">${escapeHtml(BEGINNERS_SUB2[lang] || BEGINNERS_SUB2["zh-Hant"])}</a></li>
      </ul>
    </li>`;
  const links = navItems
    .map((item) => `<li><a href="${prefix}${item.path === "/" ? "/" : item.path}">${escapeHtml(t(lang, item.key))}</a></li>`)
    .join("")
    + beginnersDropdown
    + `<li><a href="${prefix}/tougao">${escapeHtml(t(lang, "nav_submit"))}</a></li>`
    + `<li><a href="${prefix}/free">${escapeHtml(FREE_LABEL[lang] || FREE_LABEL["zh-Hant"])}</a></li>`
    + `<li><a href="${prefix}/login">${escapeHtml(LOGIN_LABEL[lang] || LOGIN_LABEL["zh-Hant"])}</a></li>`;

  // V77: 行動版選單(漢堡按鈕展開;菜鳥之友可再點擊展開子版塊)
  const mobileLinks = navItems
    .map((item) => `<li><a href="${prefix}${item.path === "/" ? "/" : item.path}">${escapeHtml(t(lang, item.key))}</a></li>`)
    .join("")
    + `
    <li class="nav-mobile-sub">
      <button type="button" class="nav-mobile-toggle" onclick="toggleNavSub(this)">${escapeHtml(BEGINNERS_LABEL[lang] || BEGINNERS_LABEL["zh-Hant"])} <span class="nav-caret">▾</span></button>
      <ul class="nav-mobile-children">
        <li><a href="${prefix}/beginners?tab=ai">${escapeHtml(BEGINNERS_SUB1[lang] || BEGINNERS_SUB1["zh-Hant"])}</a></li>
        <li><a href="${prefix}/beginners?tab=insights">${escapeHtml(BEGINNERS_SUB2[lang] || BEGINNERS_SUB2["zh-Hant"])}</a></li>
      </ul>
    </li>`
    + `<li><a href="${prefix}/tougao">${escapeHtml(t(lang, "nav_submit"))}</a></li>`
    + `<li><a href="${prefix}/free">${escapeHtml(FREE_LABEL[lang] || FREE_LABEL["zh-Hant"])}</a></li>`
    + `<li><a href="${prefix}/login">${escapeHtml(LOGIN_LABEL[lang] || LOGIN_LABEL["zh-Hant"])}</a></li>`;

  const LANG_LABELS = {
    "zh-Hant": "繁體中文", "zh-Hans": "简体中文", "en": "English",
    "fr": "Français", "de": "Deutsch", "ja": "日本語", "es": "Español",
  };
  const target = remainder === "/" ? "" : remainder;
  const options = LANG_CODES
    .map((code) => {
      const href = langPrefix(code) + target || "/";
      const selected = code === lang ? "selected" : "";
      return `<option value="${href}" ${selected}>${LANG_LABELS[code] || code}</option>`;
    })
    .join("");

  return `
    <nav class="topnav">
      <div class="nav-row">
        <button type="button" class="nav-burger" onclick="toggleNavMenu()" aria-label="menu">☰</button>
        <ul class="nav-links">${links}</ul>
        <div class="lang-select">
          <select onchange="location.href=this.value">${options}</select>
        </div>
      </div>
      <ul class="nav-mobile" id="navMobile">${mobileLinks}</ul>
    </nav>
    <script>
      function toggleNavMenu(){var m=document.getElementById('navMobile');if(!m)return;var open=m.classList.contains('open');if(open){m.classList.remove('open');}else{m.classList.add('open');}}
      function toggleNavSub(btn){var ch=btn.nextElementSibling;if(!ch)return;var open=ch.classList.contains('open');if(open){ch.classList.remove('open');}else{ch.classList.add('open');}var caret=btn.querySelector('.nav-caret');if(caret){caret.textContent=open?'▾':'▴';}}
    </script>
  `;
}

function buildFooter(lang) {
  const prefix = langPrefix(lang);
  const year = new Date().getFullYear();
  const links = [
    { key: "nav_home", path: "/" },
    { key: "footer_author", path: "/author/shengyan" },
    { key: "nav_about", path: "/about" },
    { key: "footer_privacy", path: "/privacy-policy" },
    { key: "footer_contact", path: "/contact" },
  ];
  const linksHtml = links
    .map((item) => `<a href="${prefix}${item.path === "/" ? "/" : item.path}">${escapeHtml(t(lang, item.key))}</a>`)
    .join('<span class="footer-sep">|</span>');

  return `
    <footer class="site-footer">
      <div class="footer-brand">SY Horizon</div>
      <div class="footer-links">${linksHtml}</div>
      <div class="footer-copy">© ${year} SY Horizon</div>
    </footer>
  `;
}

const DEFAULT_OG_IMAGE = "https://assets.sylogs.com/logo.png";

// 產生favicon/meta description/Open Graph/Twitter Card等head標籤,所有頁面共用
function buildHeadMeta({ title, description, path, lang, type = "website", image = DEFAULT_OG_IMAGE }) {
  const url = SITE_BASE_URL + langPrefix(lang) + (path || "/");
  const desc = (description || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const ogImage = image || DEFAULT_OG_IMAGE;
  const ogType = type || "website";

  return `
<link rel="icon" type="image/png" href="${DEFAULT_OG_IMAGE}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:site_name" content="SY Horizon">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
`;
}

function buildArticleJsonLd({ title, description, url, datePublished = "", authorName = "業州愚公", authorUrl = SITE_BASE_URL + "/author/shengyan", image = DEFAULT_OG_IMAGE }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": title,
    "description": (description || "").slice(0, 300),
    "url": url,
    "image": [image || DEFAULT_OG_IMAGE],
    "datePublished": datePublished || undefined,
    "author": { "@type": "Person", "name": authorName || "業州愚公", "url": authorUrl || (SITE_BASE_URL + "/author/shengyan") },
    "publisher": {
      "@type": "Organization",
      "name": "SY Horizon",
      "logo": { "@type": "ImageObject", "url": DEFAULT_OG_IMAGE },
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

const BASE_STYLE = `
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Microsoft JhengHei", sans-serif;
    margin: 0;
    color: #222;
    background-color: #f5f3ee;
  }
  .topnav {
    background: rgba(20,20,20,0.85);
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.6rem 1.5rem;
    flex-wrap: wrap;
    gap: 0.8rem;
  }
  .nav-links { list-style: none; display: flex; flex-wrap: wrap; margin: 0; padding: 0; gap: 1.5rem; }
  .topnav a { color: #fff; text-decoration: none; font-size: 0.95rem; }
  .topnav a:hover { color: #7fd1c0; }
  .lang-select select {
    background: rgba(255,255,255,0.1); color: #fff;
    border: 1px solid rgba(255,255,255,0.4); border-radius: 4px;
    padding: 0.3rem 0.5rem; font-size: 0.85rem;
  }
  .lang-select select option { color: #222; }
  .content-wrap { max-width: 900px; margin: 0 auto; padding: 2rem; }
  .placeholder { text-align: center; padding: 5rem 1rem; color: #555; }
  .placeholder h1 { color: #222; }
  .site-footer {
    margin-top: 3rem;
    padding: 2rem 1.5rem;
    background: rgba(20,20,20,0.9);
    color: #ccc;
    text-align: center;
  }
  .footer-brand { font-weight: 700; color: #fff; margin-bottom: 0.6rem; }
  .footer-links a { color: #ccc; text-decoration: none; font-size: 0.9rem; }
  .footer-links a:hover { color: #7fd1c0; }
  .footer-sep { margin: 0 0.6rem; color: #666; }
  .footer-copy { margin-top: 0.8rem; font-size: 0.8rem; color: #888; }
  /* V74: 英文頁面翻譯回退提示 */
  .en-fallback-note {
    padding: 0.7rem 1rem;
    border-radius: 8px;
    margin: 1rem 0;
    font-size: 0.9rem;
    line-height: 1.5;
    background: #eef3fb;
    border: 1px solid #b8d0f0;
    color: #1a4fa0;
  }
  /* V77: 菜鳥之友導覽列下拉選單 + 行動版(漢堡)選單 */
  .nav-row { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem; width: 100%; }
  .nav-burger { display: none; background: none; border: 1px solid rgba(255,255,255,0.5); color: #fff; font-size: 1.15rem; line-height: 1; padding: 0.25rem 0.55rem; border-radius: 4px; cursor: pointer; }
  .nav-dropdown { position: relative; }
  .nav-dropdown > .dropdown-menu {
    display: none; position: absolute; top: 100%; left: 0; min-width: 175px;
    background: #1c1c1c; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    padding: 0.4rem 0; margin: 0; list-style: none;
    box-shadow: 0 6px 16px rgba(0,0,0,0.35); z-index: 20;
  }
  .nav-dropdown:hover > .dropdown-menu, .nav-dropdown:focus-within > .dropdown-menu { display: block; }
  .dropdown-menu li { margin: 0; }
  .dropdown-menu a { display: block; padding: 0.5rem 1rem; white-space: nowrap; font-size: 0.9rem; }
  .dropdown-menu a:hover { background: rgba(255,255,255,0.08); color: #7fd1c0; }
  .nav-caret { font-size: 0.7rem; opacity: 0.85; }
  .nav-mobile { display: none; list-style: none; margin: 0; padding: 0.4rem 0 0.2rem 0; width: 100%; border-top: 1px solid rgba(255,255,255,0.15); }
  .nav-mobile.open { display: block; }
  .nav-mobile > li { border-bottom: 1px solid rgba(255,255,255,0.08); }
  .nav-mobile > li > a, .nav-mobile-toggle {
    display: block; width: 100%; text-align: left; background: none; border: none;
    color: #fff; padding: 0.65rem 0.4rem; font-size: 0.95rem; cursor: pointer; font-family: inherit;
  }
  .nav-mobile-toggle:hover { color: #7fd1c0; }
  .nav-mobile-children { display: none; list-style: none; margin: 0; padding: 0 0 0.5rem 1.1rem; }
  .nav-mobile-children.open { display: block; }
  .nav-mobile-children a { display: block; padding: 0.4rem 0.5rem; font-size: 0.9rem; }
  @media (max-width: 860px) {
    .nav-burger { display: inline-block; }
    .nav-links { display: none; }
  }
`;

async function renderHome(env, lang, isNewsPage, request) {
  const categories = ["時事", "科技動態", "焦點新聞", "金融", "奇聞異事"];
  let sectionsHtml = "";
  const perCategoryLimit = lang === "zh-Hant" ? 10 : 5;

  for (const cat of categories) {
    const { results } = await env.DB.prepare(
      "SELECT id, title, summary, category, link, source, published_at FROM articles WHERE category = ? ORDER BY id DESC LIMIT ?"
    ).bind(cat, perCategoryLimit).all();

    const titles = await mapWithConcurrency(results, 1, (row) =>
      getOrTranslate(env, "news", row.id, lang, "title", row.title)
    );
    const summaries = await mapWithConcurrency(results, 1, (row, i) =>
      i < 2 ? getOrExpandSummary(env, row, request) : Promise.resolve(row.summary)
    );

    let itemsHtml = "";
    results.forEach((row, i) => {
      const newsPrefix = langPrefix(lang);
      itemsHtml += `
        <article class="news-item">
          <h3><a href="${newsPrefix}/news/read?id=${row.id}">${escapeHtml(titles[i])}</a></h3>
          <p class="summary">${escapeHtml(summaries[i] || "")}</p>
          <p class="meta">${escapeHtml(t(lang, "news_source"))}:${escapeHtml(row.source || "")} | ${escapeHtml(row.published_at || "")}</p>
        </article>
      `;
    });
    if (!itemsHtml) itemsHtml = `<p>${escapeHtml(t(lang, "news_no_data"))}</p>`;

    const anchorId = "cat-" + encodeURIComponent(cat);
    sectionsHtml += `
      <section class="category-section" id="${anchorId}">
        <h2>${escapeHtml(catLabel(lang, cat))}</h2>
        ${itemsHtml}
      </section>
    `;
  }

  const catTabsHtml = categories
    .map((cat) => `<a href="#cat-${encodeURIComponent(cat)}" class="cat-tab">${escapeHtml(catLabel(lang, cat))}</a>`)
    .join("");

  const LOGO_URL = "https://assets.sylogs.com/logo.png";
  const BG_URL = "https://assets.sylogs.com/background.png";

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: t(lang, "site_name"), description: t(lang, "tagline"), path: isNewsPage ? "/news" : "/", lang })}
${isNewsPage ? '<meta name="robots" content="noindex,follow">' : ''}
<style>
  ${BASE_STYLE}
  .hero { position: relative; width: 100%; height: 60vh; min-height: 380px;
    background-image: url('${BG_URL}'); background-size: cover; background-position: center top; }
  .hero-logo { position: absolute; top: 29%; left: 6%; }
  .hero-logo img { height: 70px; }
  .hero-text { position: absolute; top: 51%; left: 6%; }
  .hero-text h1 { margin: 0; font-size: 1.8rem; color: #1a1a1a; text-shadow: 0 1px 4px rgba(255,255,255,0.7); }
  .hero-text p.tagline { margin: 0.3rem 0 0 0; font-size: 0.95rem; color: #333; text-shadow: 0 1px 4px rgba(255,255,255,0.7); }
  /* V78: 首頁 Hero 醒目的歡迎投稿按鈕 */
  .hero-submit-btn {
    display: inline-block; margin-top: 0.9rem; padding: 0.55rem 1.4rem;
    background: #1a4fa0; color: #fff; border-radius: 24px; text-decoration: none;
    font-size: 0.95rem; font-weight: 600; box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  }
  .hero-submit-btn:hover { background: #123a78; }
  .cat-tabs {
    position: sticky;
    top: 52px;
    z-index: 9;
    display: flex;
    gap: 0.8rem;
    background: #f5f3ee;
    padding: 0.8rem 0;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    border-bottom: 1px solid #ddd;
  }
  .cat-tab {
    padding: 0.4rem 1rem;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 20px;
    color: #333;
    text-decoration: none;
    font-size: 0.9rem;
  }
  .cat-tab:hover { background: #1a4fa0; color: #fff; border-color: #1a4fa0; }
  html { scroll-behavior: smooth; }
  .category-section { margin-bottom: 2.5rem; scroll-margin-top: 110px; }
  .category-section h2 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
  .news-item { border-bottom: 1px solid #ddd; padding: 1rem 0; }
  .news-item h3 { margin: 0 0 0.5rem 0; }
  .news-item a { color: #1a4fa0; text-decoration: none; }
  .news-item a:hover { text-decoration: underline; }
  .summary { color: #333; line-height: 1.6; }
  .meta { color: #888; font-size: 0.85rem; }
</style>
</head>
<body>
  ${buildNav(lang, "/")}
  <div class="hero">
    <div class="hero-logo"><img src="${LOGO_URL}" alt="logo"></div>
    <div class="hero-text">
      <h1>${escapeHtml(lang === "zh-Hant" ? "SY Horizon / SY 視野" : t(lang, "site_name"))}</h1>
      <p class="tagline">${escapeHtml(lang === "zh-Hant" ? "Diverse Perspectives, Tracking the World / 多元視野,追蹤世界" : t(lang, "tagline"))}</p>
      <p><a class="hero-submit-btn" href="${langPrefix(lang)}/tougao">📮 ${escapeHtml(t(lang, "nav_submit"))} →</a></p>
    </div>
  </div>
  <div class="content-wrap">
    ${isNewsPage ? `<div class="cat-tabs">${catTabsHtml}</div>` : ""}
    ${sectionsHtml}
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ===== V77: 菜鳥之友(Beginner's Hub)主版塊 =====
// 資料源與新聞共用 articles 表;文章詳情直接沿用 /news/read?id=(含 AI/編輯評論區塊),
// 本頁只做「依分類取文章列表 + 卡片展示」;新增三種分類:菜鳥之友 / AI與加密貨幣 / 經驗之談
const BEGINNERS_SUB_CATEGORIES = ["AI與加密貨幣", "經驗之談"];
const BEGINNERS_COMMENT_GEN_PER_SECTION = 2; // 每區塊最多即時AI生成2則評論,其餘讀既有快取或顯示「閱讀全文查看」
const BEGINNERS_COMMENT_TRANSLATE_BUDGET = 6; // 英文頁每頁評論翻譯預算(快取優先,超預算顯示原文/佔位,避免卡超時)

async function renderBeginnersPage(env, lang, url, request) {
  const tab = url ? (url.searchParams.get("tab") || "") : "";
  const showAll = tab !== "ai" && tab !== "insights";
  const perCategoryLimit = lang === "zh-Hant" ? 10 : 5;
  const prefix = langPrefix(lang);
  let commentTranslateBudget = BEGINNERS_COMMENT_TRANSLATE_BUDGET;
  let totalCards = 0;
  let allTitlesCjk = true;

  const catTabs = [
    { id: "", label: t(lang, "beginners_tab_all") },
    { id: "ai", label: t(lang, "beginners_sub_ai") },
    { id: "insights", label: t(lang, "beginners_sub_insights") },
  ];

  const renderSection = async (cat) => {
    const { results } = await env.DB.prepare(
      "SELECT id, title, summary, category, source, published_at, editor_comment FROM articles WHERE category = ? ORDER BY id DESC LIMIT ?"
    ).bind(cat, perCategoryLimit).all();

    // 標題:快取優先翻譯(zh-Hant 短路不回傳原文以外結果)
    const titlesT = await mapWithConcurrency(results, 1, (row) =>
      getOrTranslate(env, "news", row.id, lang, "title", row.title)
    );
    // 摘要:新文章前2則順便擴充,再翻譯
    const summariesT = await mapWithConcurrency(results, 1, (row, i) => {
      const base = i < 2 ? getOrExpandSummary(env, row, request) : Promise.resolve(row.summary || "");
      return base.then((s) => getOrTranslate(env, "news", row.id, lang, "summary", s));
    });
    // 評論:有 editor_comment 直接用;沒有的前2則即時AI生成;英文頁翻譯受預算限制(快取優先)
    const commentsT = [];
    for (let i = 0; i < results.length; i++) {
      const row = results[i];
      let raw = "";
      if (row.editor_comment && row.editor_comment.trim()) {
        raw = row.editor_comment;
      } else if (i < BEGINNERS_COMMENT_GEN_PER_SECTION) {
        raw = (await getOrGenerateComment(env, row, request)) || "";
      }
      if (raw) {
        if (lang === "zh-Hant") {
          commentsT.push(raw);
        } else {
          let tr = raw;
          try {
            const cached = await env.DB.prepare(
              "SELECT translated_text FROM translations WHERE content_type = 'news' AND content_id = ? AND lang = ? AND field = 'editor_comment'"
            ).bind(row.id, lang).first();
            if (cached && cached.translated_text && String(cached.translated_text).trim()) {
              tr = cached.translated_text;
            } else if (commentTranslateBudget > 0) {
              commentTranslateBudget--;
              tr = await getOrTranslate(env, "news", row.id, lang, "editor_comment", raw);
            }
          } catch (e) { tr = raw; }
          commentsT.push(tr);
        }
      } else {
        commentsT.push("");
      }
    }

    const cjkCount = titlesT.filter((t) => containsCjk(t)).length;
    totalCards += results.length;
    if (cjkCount < results.length) allTitlesCjk = false;

    let cardsHtml = results.map((row, i) => {
      const comment = commentsT[i];
      let commentHtml;
      if (comment && (lang === "zh-Hant" || !containsCjk(comment))) {
        commentHtml = `<div class="beg-comment"><span class="beg-comment-label">${escapeHtml(t(lang, "beginners_editor_note"))}</span>${escapeHtml(comment)}</div>`;
      } else {
        commentHtml = `<div class="beg-comment beg-comment-empty">${escapeHtml(t(lang, "beginners_comment_soon"))} <a href="${prefix}/news/read?id=${row.id}">${escapeHtml(t(lang, "beginners_read_article"))}</a></div>`;
      }
      return `
        <article class="beg-card">
          <div class="beg-card-head">
            <span class="beg-tag">${escapeHtml(catLabel(lang, row.category))}</span>
            <span class="beg-date">${escapeHtml(row.published_at || "")}</span>
          </div>
          <h3 class="beg-title"><a href="${prefix}/news/read?id=${row.id}">${escapeHtml(titlesT[i])}</a></h3>
          <p class="beg-summary">${escapeHtml(summariesT[i] || "")}</p>
          ${commentHtml}
          <div class="beg-more"><a href="${prefix}/news/read?id=${row.id}">${escapeHtml(t(lang, "beginners_read_article"))}</a></div>
        </article>
      `;
    }).join("");
    if (!cardsHtml) cardsHtml = `<p class="beg-empty">${escapeHtml(t(lang, "beginners_no_data"))}</p>`;

    return `
      <section class="beg-section" id="beg-${cat === "AI與加密貨幣" ? "ai" : "insights"}">
        <h2 class="beg-section-title">${escapeHtml(catLabel(lang, cat))}</h2>
        <div class="beg-grid">${cardsHtml}</div>
      </section>
    `;
  };

  const sectionsToRender = showAll
    ? BEGINNERS_SUB_CATEGORIES
    : [BEGINNERS_SUB_CATEGORIES[tab === "ai" ? 0 : 1]];
  let sectionsHtml = "";
  for (const cat of sectionsToRender) {
    sectionsHtml += await renderSection(cat);
  }

  // V74: 英文頁若所有卡片標題都仍是中文(翻譯失敗回退),顯示「coming soon」提示
  const listNoteHtml = (lang === "en" && totalCards > 0 && allTitlesCjk)
    ? `<div class="en-fallback-note">🌐 English version coming soon — showing the original Chinese text for now.</div>`
    : "";

  const tabBarHtml = catTabs.map((tb) => {
    const href = tb.id ? `${prefix}/beginners?tab=${tb.id}` : `${prefix}/beginners`;
    const cls = (showAll && !tb.id) || (!showAll && tab === tb.id) ? "active" : "";
    return `<a href="${href}" class="beg-tab ${cls}">${escapeHtml(tb.label)}</a>`;
  }).join("");

  const begEnLabel = (lang === "zh-Hant" || lang === "zh-Hans") ? ` <span class="beg-en">Beginner's Hub</span>` : "";

  const page = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t(lang, "nav_beginners"))} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: t(lang, "nav_beginners") + " - SY Horizon", description: t(lang, "beginners_meta_desc"), path: "/beginners", lang })}
<style>
  ${BASE_STYLE}
  .beg-en { color: #888; font-size: 0.85rem; font-weight: 400; }
  .beg-intro { color: #444; line-height: 1.8; margin: 0.5rem 0 1.2rem 0; }
  .beg-tabs { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 1.5rem; border-bottom: 2px solid #ddd; padding-bottom: 0.6rem; }
  .beg-tab { padding: 0.45rem 1.1rem; background: #fff; border: 1px solid #ccc; border-radius: 20px; color: #333; text-decoration: none; font-size: 0.9rem; }
  .beg-tab:hover { background: #1a4fa0; color: #fff; border-color: #1a4fa0; }
  .beg-tab.active { background: #1a4fa0; color: #fff; border-color: #1a4fa0; font-weight: 600; }
  .beg-section { margin-bottom: 2.2rem; }
  .beg-section-title { border-left: 4px solid #1a4fa0; padding-left: 0.6rem; }
  .beg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.2rem; }
  .beg-card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1.1rem 1.2rem; display: flex; flex-direction: column; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .beg-card-head { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem; }
  .beg-tag { display: inline-block; background: #e8f0fb; color: #1a4fa0; font-size: 0.75rem; padding: 0.15rem 0.6rem; border-radius: 10px; font-weight: 600; }
  .beg-date { color: #999; font-size: 0.78rem; }
  .beg-title { margin: 0 0 0.5rem 0; font-size: 1.02rem; line-height: 1.45; }
  .beg-title a { color: #1a1a1a; text-decoration: none; }
  .beg-title a:hover { color: #1a4fa0; text-decoration: underline; }
  .beg-summary { color: #444; font-size: 0.88rem; line-height: 1.65; margin: 0 0 0.8rem 0; }
  .beg-comment { background: #fff8ea; border-left: 3px solid #d4a017; padding: 0.55rem 0.7rem; border-radius: 4px; font-size: 0.82rem; line-height: 1.55; color: #5c4a12; margin: auto 0 0.7rem 0; }
  .beg-comment-label { font-weight: 700; color: #8a6300; margin-right: 0.3rem; }
  .beg-comment-empty { background: #f5f5f2; border-left-color: #bbb; color: #888; }
  .beg-comment-empty a { color: #1a4fa0; text-decoration: none; }
  .beg-more a { color: #1a4fa0; text-decoration: none; font-size: 0.85rem; }
  .beg-more a:hover { text-decoration: underline; }
  .beg-empty { color: #888; }
</style>
</head>
<body>
  ${buildNav(lang, "/beginners")}
  <div class="content-wrap">
    <h1>${escapeHtml(t(lang, "nav_beginners"))}${begEnLabel}</h1>
    <p class="beg-intro">${escapeHtml(t(lang, "beginners_intro"))}</p>
    ${listNoteHtml}
    <div class="beg-tabs">${tabBarHtml}</div>
    ${sectionsHtml}
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ===== V78: 歡迎投稿 — 網頁直接收稿(不經 Email) =====
// 訪客在 /tougao 表單提交 → 寫入 submissions 表(status='pending' 待審)→ 站長審查通過後才轉存 articles 發佈,
// 未審稿件絕不會出現在前端,保證內容安全。若 D1 尚未建表,程式會在首次投稿時自動 CREATE TABLE(冪等)。
const SUBMISSIONS_DAILY_PER_IP = 5;
const SUBMISSIONS_DAILY_GLOBAL = 200;
const SUBMISSIONS_MAX_TITLE = 200;
const SUBMISSIONS_MAX_CONTENT = 20000;
// value 為寫入資料庫的分類(中文正體,方便 D1 Console 審閱);key 為 i18n 顯示標籤
const SUBMIT_CATEGORY_DEFS = [
  { value: "新聞追蹤", key: "submit_category_news" },
  { value: "文學作品", key: "submit_category_literature" },
  { value: "避坑指南", key: "submit_category_guide" },
  { value: "菜鳥之友", key: "submit_category_beginners" },
  { value: "多媒體", key: "submit_category_media" },
  { value: "其他", key: "submit_category_other" },
];

async function ensureSubmissionsTable(env) {
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS submissions (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "nickname TEXT NOT NULL, email TEXT NOT NULL, title TEXT NOT NULL, " +
      "category TEXT NOT NULL DEFAULT '', content TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '', " +
      "status TEXT NOT NULL DEFAULT 'pending', ip TEXT NOT NULL DEFAULT '', " +
      "created_at TEXT NOT NULL DEFAULT (datetime('now')))"
    ).run();
  } catch (e) {
    // 建表失敗不阻擋;若真的沒表,後續 INSERT 會由呼叫端以 submit_error 回覆
  }
}

// 回傳 { ok: true, id } 或 { ok: false, reason: 'rate' | 'error' }
async function insertSubmission(env, data) {
  await ensureSubmissionsTable(env);
  const today = new Date().toISOString().slice(0, 10);
  // 同 IP 每日上限
  try {
    const ipRow = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM submissions WHERE ip = ? AND date(created_at) = ?"
    ).bind(data.ip, today).first();
    if (ipRow && Number(ipRow.c || 0) >= SUBMISSIONS_DAILY_PER_IP) return { ok: false, reason: "rate" };
  } catch (e) {}
  // 全站每日上限
  try {
    const gRow = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM submissions WHERE date(created_at) = ?"
    ).bind(today).first();
    if (gRow && Number(gRow.c || 0) >= SUBMISSIONS_DAILY_GLOBAL) return { ok: false, reason: "rate" };
  } catch (e) {}
  try {
    const res = await env.DB.prepare(
      "INSERT INTO submissions (nickname, email, title, category, content, evidence, status, ip) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
    ).bind(data.nickname, data.email, data.title, data.category, data.content, data.evidence, data.ip).run();
    return { ok: true, id: (res && res.meta && res.meta.last_row_id) || null };
  } catch (e) {
    return { ok: false, reason: "error" };
  }
}

// 表單欄位驗證與清理;回傳 { error: 'required'|'email' } 或 { data }
function normalizeSubmission(input) {
  const nickname = String(input.nickname || "").trim().slice(0, 50);
  const email = String(input.email || "").trim().slice(0, 200);
  const title = String(input.title || "").trim().slice(0, SUBMISSIONS_MAX_TITLE);
  const category = String(input.category || "").trim();
  const content = String(input.content || "").trim().slice(0, SUBMISSIONS_MAX_CONTENT);
  const evidence = String(input.evidence || "").trim().slice(0, 2000);
  if (!nickname || !email || !title || !content) return { error: "required" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "email" };
  const validCat = SUBMIT_CATEGORY_DEFS.some((c) => c.value === category);
  return { data: { nickname, email, title, category: validCat ? category : "其他", content, evidence } };
}

// 表單 POST /tougao → 驗證 → 寫庫 → 302 重新導向(PRG 模式,重新整理不會重複投稿)
async function handleTougaoSubmit(request, env, lang) {
  const prefix = langPrefix(lang);
  try {
    const form = await request.formData();
    // 蜜罐欄位:真人看不到也不會填;被填入代表是機器人,假裝成功但實際丟棄
    if (form.get("website")) {
      return Response.redirect(new URL(prefix + "/tougao?ok=1", request.url).toString(), 302);
    }
    const input = {};
    for (const key of ["nickname", "email", "title", "category", "content", "evidence"]) input[key] = form.get(key);
    const norm = normalizeSubmission(input);
    if (norm.error) {
      const errMsg = norm.error === "email" ? t(lang, "submit_email_invalid") : t(lang, "submit_required");
      return renderTougaoPage(env, lang, null, { error: errMsg, values: input, status: 400 });
    }
    const ip = (request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown").split(",")[0].trim().slice(0, 64);
    const res = await insertSubmission(env, { ...norm.data, ip });
    if (!res.ok) {
      return renderTougaoPage(env, lang, null, { error: t(lang, "submit_rate_limited"), values: input, status: 429 });
    }
    return Response.redirect(new URL(prefix + "/tougao?ok=1", request.url).toString(), 302);
  } catch (e) {
    return renderTougaoPage(env, lang, null, { error: t(lang, "submit_error"), status: 500 });
  }
}

// JSON API:POST /api/submit-article(供前端 fetch 或第三方整合;格式同表單)
async function handleSubmitArticleApi(request, env) {
  try {
    const body = await request.json();
    if (body && body.website) {
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    const norm = normalizeSubmission(body || {});
    if (norm.error) {
      return new Response(JSON.stringify({ ok: false, reason: norm.error }), {
        status: 400, headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const ip = (request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown").split(",")[0].trim().slice(0, 64);
    const res = await insertSubmission(env, { ...norm.data, ip });
    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, reason: res.reason }), {
        status: res.reason === "rate" ? 429 : 500, headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return new Response(JSON.stringify({ ok: true, id: res.id }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: "error" }), {
      status: 500, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

// ===== V80: 管理審稿頁(受 SUBMISSIONS_ADMIN_KEY 環境變數保護) =====
// 流程:GET /admin(登入頁)→ POST /admin/login(驗證金鑰→設 cookie)→ GET /admin/submissions(待審清單)
// → POST /admin/submissions/action(一鍵發佈/退回;發佈自動寫入 articles/literature 並生成兌換碼)
// 未設定 SUBMISSIONS_ADMIN_KEY 時,管理頁一律鎖定並提示設定方式。
const ADMIN_COOKIE_NAME = "sylogs_admin";
const ADMIN_COOKIE_SALT = "::sylogs-admin-review-v1";
const ADMIN_REDEEM_SLUG = "overseas-life-guide";
const ADMIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去除易混淆的 0/O/1/I
const ADMIN_PUBLISH_CATEGORIES = [
  { value: "時事", label: "新聞：時事" },
  { value: "科技動態", label: "新聞：科技動態" },
  { value: "焦點新聞", label: "新聞：焦點新聞" },
  { value: "金融", label: "新聞：金融" },
  { value: "奇聞異事", label: "新聞：奇聞異事" },
  { value: "AI與加密貨幣", label: "菜鳥之友：AI與加密貨幣" },
  { value: "經驗之談", label: "菜鳥之友：經驗之談" },
  { value: "菜鳥之友", label: "菜鳥之友（主版塊）" },
  { value: "其他", label: "其他" },
  { value: "lit:原創投稿", label: "文學版塊：原創投稿" },
];

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function isAdminAuthed(request, env) {
  const key = env.SUBMISSIONS_ADMIN_KEY;
  if (!key) return false;
  const cookie = (request.headers.get("Cookie") || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(ADMIN_COOKIE_NAME + "="));
  if (!cookie) return false;
  const expected = await sha256Hex(key + ADMIN_COOKIE_SALT);
  return cookie.slice(ADMIN_COOKIE_NAME.length + 1) === expected;
}

async function ensureSubmissionsReviewedAt(env) {
  try { await env.DB.prepare("ALTER TABLE submissions ADD COLUMN reviewed_at TEXT").run(); } catch (e) { /* 欄位已存在時忽略 */ }
}

const ADMIN_NOINDEX = { "X-Robots-Tag": "noindex, nofollow" };

function renderAdminLoginPage(env, error) {
  const keySet = !!(env.SUBMISSIONS_ADMIN_KEY && String(env.SUBMISSIONS_ADMIN_KEY).trim());
  const warnHtml = keySet ? "" : `<div class="adm-flash err">⚠️ 尚未設定 <code>SUBMISSIONS_ADMIN_KEY</code> 環境變數——管理頁已鎖定。請在 Cloudflare Worker 的「設定 → 變數」加入此變數(任選一組夠長的字串)後重新載入本頁。</div>`;
  const errHtml = error ? `<div class="adm-flash err">金鑰錯誤，請重試。</div>` : "";
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>管理審稿 - 登入</title>
<style>
${BASE_STYLE}
body { background:#f4f5f7; }
.adm-login-wrap { max-width:420px; margin:12vh auto 0; background:#fff; border:1px solid #ddd; border-radius:10px; padding:2rem 2.2rem; box-shadow:01px4px rgba(0,0,0,0.08); }
.adm-login-wrap h1 { margin:000.9rem0; font-size:1.25rem; }
.adm-login-wrap p { color:#666; font-size:0.88rem; margin:000.9rem0; line-height:1.6; }
.adm-login-wrap input[type=password] { width:100%; box-sizing:border-box; padding:0.6rem0.7rem; border:1px solid #ccc; border-radius:6px; font-size:1rem; margin-bottom:0.9rem; }
.adm-login-wrap button { width:100%; padding:0.7rem; background:#1a4fa0; color:#fff; border:none; border-radius:6px; font-size:1rem; cursor:pointer; }
.adm-login-wrap button:hover { background:#123a78; }
</style>
</head>
<body>
<div class="adm-login-wrap">
<h1>🔐 管理審稿登入</h1>
<p>請輸入管理金鑰(即 Worker 環境變數 <code>SUBMISSIONS_ADMIN_KEY</code> 的值)。</p>
${warnHtml}
${errHtml}
<form method="post" action="/admin/login">
<input type="password" name="key" placeholder="管理金鑰" autocomplete="current-password" required>
<button type="submit">登入</button>
</form>
</div>
</body>
</html>`;
}

async function handleAdminLogin(request, env) {
  const form = await request.formData();
  const key = String(env.SUBMISSIONS_ADMIN_KEY || "");
  const input = String(form.get("key") || "");
  const url = new URL(request.url);
  if (key && input === key) {
    const h = await sha256Hex(key + ADMIN_COOKIE_SALT);
    const headers = new Headers();
    headers.append("Location", url.origin + "/admin/submissions");
    headers.append("Set-Cookie", `${ADMIN_COOKIE_NAME}=${h}; Path=/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax`);
    return new Response(null, { status: 302, headers });
  }
  return Response.redirect(new URL("/admin?error=1", request.url).toString(), 302);
}

async function handleAdminLogout(request, env) {
  const headers = new Headers();
  headers.append("Location", new URL("/admin", request.url).toString());
  headers.append("Set-Cookie", `${ADMIN_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return new Response(null, { status: 302, headers });
}

async function renderAdminPage(request, env) {
  if (await isAdminAuthed(request, env)) {
    return Response.redirect(new URL("/admin/submissions", request.url).toString(), 302);
  }
  const url = new URL(request.url);
  const html = renderAdminLoginPage(env, url.searchParams.get("error") === "1");
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...ADMIN_NOINDEX } });
}

async function renderAdminSubmissions(request, env) {
  if (!(await isAdminAuthed(request, env))) return Response.redirect(new URL("/admin", request.url).toString(), 302);
  await ensureSubmissionsTable(env);
  await ensureSubmissionsReviewedAt(env);
  const esc = escapeHtml;
  const url = new URL(request.url);
  const msgCode = url.searchParams.get("code") || "";
  const msgDone = url.searchParams.get("done") === "1";
  const msgRejected = url.searchParams.get("rejected") === "1";
  const errKey = url.searchParams.get("err") || "";
  const errMap = { noid: "缺少稿件編號", notfound: "找不到該稿件", notpending: "該稿件已不是待審狀態", db: "寫入 articles 失敗，請檢查欄位(例如 image_url/link 是否 NOT NULL)", lit: "寫入 literature 失敗", code: "兌換碼建立失敗——請確認 access_codes 表存在；若需自訂時長，先在 D1 執行 ALTER TABLE access_codes ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 365;" };
  let pending = [], done = [], counts = [];
  try { pending = ((await env.DB.prepare("SELECT * FROM submissions WHERE status = 'pending' ORDER BY id DESC LIMIT 100").all()).results) || []; } catch (e) { pending = []; }
  try { done = ((await env.DB.prepare("SELECT id, nickname, email, title, category, status, created_at, reviewed_at FROM submissions WHERE status != 'pending' ORDER BY id DESC LIMIT 50").all()).results) || []; } catch (e) { done = []; }
  try { counts = ((await env.DB.prepare("SELECT status, COUNT(*) AS c FROM submissions GROUP BY status").all()).results) || []; } catch (e) { counts = []; }
  const countOf = (s) => { const r = counts.find((x) => x.status === s); return r ? Number(r.c) : 0; };

  const catOptions = ADMIN_PUBLISH_CATEGORIES.map((c) => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join("");
  const durationOptions = `<option value="30">薄酬：1個月</option><option value="90">薄酬：3個月</option><option value="365">薄酬：1年</option>`;

  const pendingHtml = pending.length
    ? pending.map((row) => `
 <article class="adm-card">
 <div class="adm-head">
 <span class="adm-id">#${row.id}</span>
 <strong class="adm-title">${esc(row.title)}</strong>
 <span class="adm-tag">${esc(row.category || "未選")}</span>
 <span class="adm-date">${esc(row.created_at || "")}</span>
 </div>
 <div class="adm-meta">投稿者：${esc(row.nickname || "?")}（${esc(row.email || "")}）｜${row.evidence ? "📎 " + esc(row.evidence) : "無補充證據"}</div>
 <pre class="adm-content">${esc(row.content || "")}</pre>
 <form method="post" action="/admin/submissions/action" class="adm-actions">
 <input type="hidden" name="id" value="${row.id}">
 <label>發佈到 <select name="category">${catOptions}</select></label>
 <label>薄酬 <select name="duration">${durationOptions}</select></label>
 <button type="submit" name="action" value="approve" class="adm-btn ok">✅ 發佈</button>
 <button type="submit" name="action" value="reject" class="adm-btn no">✖ 退回</button>
 </form>
 </article>`).join("")
    : `<div class="adm-empty">🎉 目前沒有待審稿件。</div>`;

  const doneHtml = done.length
    ? `<table class="adm-table"><thead><tr><th>#</th><th>標題</th><th>投稿者</th><th>狀態</th><th>投稿時間</th><th>審稿時間</th></tr></thead><tbody>` + done.map((row) => `
 <tr>
 <td>${row.id}</td>
 <td>${esc(row.title)}</td>
 <td>${esc(row.nickname || "")}</td>
 <td>${row.status === "published" ? '<span class="adm-badge ok">已發佈</span>' : '<span class="adm-badge no">已退回</span>'}</td>
 <td>${esc(row.created_at || "")}</td>
 <td>${esc(row.reviewed_at || "")}</td>
 </tr>`).join("") + `</tbody></table>`
    : `<div class="adm-empty">尚無已處理紀錄。</div>`;

  const flash = [
    msgCode ? `<div class="adm-flash ok">✅ 已發佈！請 email 給投稿者兌換碼：<code class="adm-code">${esc(msgCode)}</code>（請投稿者到 sylogs.com/redeem 兌換）</div>` : "",
    (msgDone && !msgCode) ? `<div class="adm-flash ok">✅ 已發佈（未生成兌換碼，見下方提示）</div>` : "",
    msgRejected ? `<div class="adm-flash">已退回該稿件。</div>` : "",
    errKey ? `<div class="adm-flash err">⚠️ ${esc(errMap[errKey] || errKey)}</div>` : "",
  ].join("");

  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>管理審稿 - 投稿專區</title>
<style>
${BASE_STYLE}
body { background:#f4f5f7; }
.adm-bar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.6rem; margin-bottom:1.2rem; }
.adm-bar h1 { margin:0; font-size:1.3rem; }
.adm-bar .adm-sub { color:#777; font-size:0.85rem; }
.adm-stats { display:flex; gap:0.8rem; flex-wrap:wrap; margin-bottom:1.4rem; }
.adm-stat { background:#fff; border:1px solid #ddd; border-radius:8px; padding:0.5rem1.1rem; font-size:0.9rem; }
.adm-stat b { font-size:1.15rem; margin-right:0.3rem; }
.adm-stat.pending b { color:#d4a017; } .adm-stat.pub b { color:#2e7d32; } .adm-stat.rej b { color:#b71c1c; }
.adm-flash { padding:0.8rem1rem; border-radius:6px; margin-bottom:1rem; font-size:0.92rem; line-height:1.6; }
.adm-flash.ok { background:#e8f5e9; border:1px solid #a5d6a7; color:#2e7d32; }
.adm-flash.err { background:#fdecea; border:1px solid #ef9a9a; color:#b71c1c; }
.adm-flash { background:#fff8ea; border:1px solid #f0d9a8; color:#7a5c00; }
.adm-code { background:#fff; border:1px dashed #bbb; padding:0.15rem0.5rem; border-radius:4px; font-size:1.05rem; letter-spacing:1px; user-select:all; }
.adm-card { background:#fff; border:1px solid #ddd; border-radius:10px; padding:1.1rem1.3rem; margin-bottom:1.2rem; box-shadow:01px3px rgba(0,0,0,0.06); }
.adm-head { display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap; }
.adm-id { color:#999; font-size:0.85rem; }
.adm-title { font-size:1.05rem; }
.adm-tag { background:#e8f0fb; color:#1a4fa0; font-size:0.75rem; padding:0.12rem0.55rem; border-radius:10px; }
.adm-date { color:#999; font-size:0.78rem; margin-left:auto; }
.adm-meta { color:#555; font-size:0.85rem; margin:0.5rem0; }
.adm-content { background:#faf9f6; border:1px solid #eee; border-radius:6px; padding:0.8rem; max-height:260px; overflow:auto; white-space:pre-wrap; word-break:break-word; font-size:0.88rem; line-height:1.7; color:#333; }
.adm-actions { display:flex; gap:0.7rem; align-items:center; flex-wrap:wrap; margin-top:0.8rem; }
.adm-actions label { font-size:0.85rem; color:#555; display:flex; align-items:center; gap:0.3rem; }
.adm-actions select { padding:0.35rem0.5rem; border:1px solid #ccc; border-radius:5px; font-size:0.85rem; }
.adm-btn { padding:0.5rem1.2rem; border:none; border-radius:6px; font-size:0.92rem; font-weight:600; cursor:pointer; color:#fff; }
.adm-btn.ok { background:#2e7d32; } .adm-btn.ok:hover { background:#1b5e20; }
.adm-btn.no { background:#b71c1c; } .adm-btn.no:hover { background:#7f1414; }
.adm-empty { color:#888; padding:1.5rem0; }
.adm-table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #ddd; border-radius:8px; font-size:0.85rem; }
.adm-table th, .adm-table td { padding:0.55rem0.7rem; border-bottom:1px solid #eee; text-align:left; }
.adm-table th { background:#f7f8fa; }
.adm-badge { font-size:0.75rem; padding:0.1rem0.5rem; border-radius:9px; }
.adm-badge.ok { background:#e8f5e9; color:#2e7d32; } .adm-badge.no { background:#fdecea; color:#b71c1c; }
.adm-logout { background:none; border:1px solid #ccc; color:#555; padding:0.3rem0.8rem; border-radius:5px; cursor:pointer; font-size:0.85rem; }
.adm-section-title { margin:1.8rem000.7rem0; font-size:1.05rem; border-left:4px solid #1a4fa0; padding-left:0.6rem; }
</style>
</head>
<body>
<div class="content-wrap">
<div class="adm-bar">
<h1>📮 投稿管理審稿</h1>
<span class="adm-sub">待審稿件直接在此一鍵發佈或退回；發佈後自動生成兌換碼。</span>
<form method="post" action="/admin/logout" style="margin:0"><button class="adm-logout" type="submit">登出</button></form>
</div>
${flash}
<div class="adm-stats">
<div class="adm-stat pending">待審 <b>${countOf("pending")}</b>篇</div>
<div class="adm-stat pub">已發佈 <b>${countOf("published")}</b>篇</div>
<div class="adm-stat rej">已退回 <b>${countOf("rejected")}</b>篇</div>
</div>
<h2 class="adm-section-title">待審稿件（${pending.length}）</h2>
${pendingHtml}
<h2 class="adm-section-title">已處理紀錄（最近50筆）</h2>
${doneHtml}
</div>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...ADMIN_NOINDEX } });
}

async function handleAdminAction(request, env) {
  if (!(await isAdminAuthed(request, env))) return Response.redirect(new URL("/admin", request.url).toString(), 302);
  await ensureSubmissionsTable(env);
  await ensureSubmissionsReviewedAt(env);
  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  const action = String(form.get("action") || "");
  const category = String(form.get("category") || "").trim() || "時事";
  const durationRaw = parseInt(form.get("duration") || "30", 10);
  const duration = [30, 90, 365].includes(durationRaw) ? durationRaw : 30;
  const base = new URL("/admin/submissions", request.url);
  if (!id) { base.searchParams.set("err", "noid"); return Response.redirect(base.toString(), 302); }
  let row = null;
  try { row = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first(); } catch (e) { row = null; }
  if (!row) { base.searchParams.set("err", "notfound"); return Response.redirect(base.toString(), 302); }
  if (row.status !== "pending") { base.searchParams.set("err", "notpending"); return Response.redirect(base.toString(), 302); }

  if (action === "reject") {
    await env.DB.prepare("UPDATE submissions SET status = 'rejected', reviewed_at = datetime('now') WHERE id = ?").bind(id).run().catch(() => {});
    base.searchParams.set("rejected", "1");
    return Response.redirect(base.toString(), 302);
  }
  if (action !== "approve") { base.searchParams.set("err", "noid"); return Response.redirect(base.toString(), 302); }

  // 發佈:先寫入正式內容表,成功才改投稿狀態
  const isLit = category.indexOf("lit:") === 0;
  try {
    if (isLit) {
      const litCat = category.slice(4) || "原創投稿";
      await env.DB.prepare("INSERT INTO literature (title, author, category, content, source_lang) VALUES (?, ?, ?, ?, 'zh')")
        .bind(row.title, row.nickname || "讀者", litCat, row.content).run();
    } else {
      const summary = String(row.content || "").slice(0, 150);
      await env.DB.prepare("INSERT INTO articles (title, summary, category, source, published_at, link, editor_comment, image_url) VALUES (?, ?, ?, '讀者投稿', datetime('now'), '', '', '')")
        .bind(row.title, summary, category).run();
    }
  } catch (e) {
    base.searchParams.set("err", isLit ? "lit" : "db");
    return Response.redirect(base.toString(), 302);
  }
  await env.DB.prepare("UPDATE submissions SET status = 'published', reviewed_at = datetime('now') WHERE id = ?").bind(id).run().catch(() => {});

  // 生成兌換碼(access_codes 若沒有 duration_days 欄位,自動降級為固定365天重試)
  let code = "";
  for (let attempt = 0; attempt < 3 && !code; attempt++) {
    code = "SYGIFT-" + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => ADMIN_CODE_CHARS[b % ADMIN_CODE_CHARS.length]).join("");
    try {
      await env.DB.prepare("INSERT INTO access_codes (code, tool_slug, duration_days) VALUES (?, ?, ?)").bind(code, ADMIN_REDEEM_SLUG, duration).run();
    } catch (e1) {
      try {
        await env.DB.prepare("INSERT INTO access_codes (code, tool_slug) VALUES (?, ?)").bind(code, ADMIN_REDEEM_SLUG).run();
      } catch (e2) { code = ""; }
    }
  }
  if (code) base.searchParams.set("code", code);
  else base.searchParams.set("err", "code");
  base.searchParams.set("done", "1");
  return Response.redirect(base.toString(), 302);
}

// 歡迎投稿頁面:GET /tougao(?ok=1 顯示成功訊息)
function renderTougaoPage(env, lang, url, opts) {
  opts = opts || {};
  const prefix = langPrefix(lang);
  const ok = opts.ok === true || !!(url && url.searchParams && url.searchParams.get("ok") === "1");
  const error = opts.error || "";
  const v = opts.values || {};
  const esc = escapeHtml;
  const catOptions = SUBMIT_CATEGORY_DEFS.map((c) => {
    const selected = (v.category || "") === c.value ? " selected" : "";
    return `<option value="${esc(c.value)}"${selected}>${esc(t(lang, c.key))}</option>`;
  }).join("");
  const okBanner = ok ? `<div class="submit-msg ok">${esc(t(lang, "submit_ok"))}</div>` : "";
  const errBanner = error ? `<div class="submit-msg err">${esc(error)}</div>` : "";
  const enLabel = (lang === "zh-Hant" || lang === "zh-Hans") ? ` <span class="beg-en">Welcome Submissions</span>` : "";

  const page = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t(lang, "submit_page_title"))} - ${esc(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: t(lang, "submit_page_title") + " - SY Horizon", description: t(lang, "submit_meta_desc"), path: "/tougao", lang })}
<style>
  ${BASE_STYLE}
  .beg-en { color: #888; font-size: 0.85rem; font-weight: 400; }
  .submit-hero { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 1.5rem 1.8rem; margin-bottom: 1.8rem; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  .submit-hero h1 { margin: 0 0 0.6rem 0; }
  .submit-hero ul { line-height: 2; padding-left: 1.4rem; margin: 0.4rem 0 0.8rem 0; }
  .submit-hero li { margin: 0.2rem 0; }
  .submit-note { background: #fff8ea; border-left: 4px solid #d4a017; padding: 0.9rem 1.1rem; border-radius: 4px; color: #5c4a12; line-height: 1.8; font-size: 0.95rem; margin: 0.6rem 0 0 0; }
  .submit-msg { padding: 0.8rem 1rem; border-radius: 6px; margin-bottom: 1.2rem; font-size: 0.95rem; }
  .submit-msg.ok { background: #e8f5e9; border: 1px solid #a5d6a7; color: #2e7d32; }
  .submit-msg.err { background: #fdecea; border: 1px solid #ef9a9a; color: #b71c1c; }
  .submit-form { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 1.5rem 1.8rem; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  .submit-form h2 { margin: 0 0 1rem 0; }
  .submit-field { margin-bottom: 1.1rem; }
  .submit-field label { display: block; font-weight: 600; margin-bottom: 0.35rem; font-size: 0.92rem; }
  .submit-field input[type=text], .submit-field input[type=email], .submit-field select, .submit-field textarea {
    width: 100%; padding: 0.6rem 0.7rem; border: 1px solid #ccc; border-radius: 6px;
    font-size: 0.95rem; font-family: inherit; box-sizing: border-box; background: #fbfaf8;
  }
  .submit-field textarea { min-height: 220px; line-height: 1.7; }
  .submit-field .hint { color: #888; font-size: 0.8rem; margin-top: 0.25rem; }
  .submit-hp { display: none !important; } /* 蜜罐欄位:對真人隱藏 */
  .submit-actions { display: flex; gap: 0.8rem; align-items: center; flex-wrap: wrap; }
  .submit-btn { padding: 0.7rem 2rem; background: #1a4fa0; color: #fff; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; }
  .submit-btn:hover { background: #123a78; }
  .submit-back { color: #1a4fa0; text-decoration: none; font-size: 0.9rem; }
  .submit-back:hover { text-decoration: underline; }
  @media (max-width: 640px) { .submit-form, .submit-hero { padding: 1.1rem 1rem; } }
</style>
</head>
<body>
  ${buildNav(lang, "/tougao")}
  <div class="content-wrap">
    ${okBanner}
    ${errBanner}
    <div class="submit-hero">
      <h1>${esc(t(lang, "submit_page_title"))}${enLabel}</h1>
      <p><strong>${esc(t(lang, "submit_welcome_heading"))}</strong></p>
      <ul>
        <li>${esc(t(lang, "submit_welcome_p1"))}</li>
        <li>${esc(t(lang, "submit_welcome_p2"))}</li>
      </ul>
      <p class="submit-note">${esc(t(lang, "submit_note_fee"))}</p>
    </div>
    <div class="submit-form">
      <h2>${esc(t(lang, "submit_form_title"))}</h2>
      <form method="post" action="${prefix}/tougao">
        <div class="submit-hp"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="submit-field">
          <label for="f-name">${esc(t(lang, "submit_label_name"))}</label>
          <input type="text" id="f-name" name="nickname" value="${esc(v.nickname || "")}" placeholder="${esc(t(lang, "submit_placeholder_name"))}" required maxlength="50">
        </div>
        <div class="submit-field">
          <label for="f-email">${esc(t(lang, "submit_label_email"))}</label>
          <input type="email" id="f-email" name="email" value="${esc(v.email || "")}" placeholder="${esc(t(lang, "submit_placeholder_email"))}" required maxlength="200">
        </div>
        <div class="submit-field">
          <label for="f-title">${esc(t(lang, "submit_label_title"))}</label>
          <input type="text" id="f-title" name="title" value="${esc(v.title || "")}" placeholder="${esc(t(lang, "submit_placeholder_title"))}" required maxlength="${SUBMISSIONS_MAX_TITLE}">
        </div>
        <div class="submit-field">
          <label for="f-cat">${esc(t(lang, "submit_label_category"))}</label>
          <select id="f-cat" name="category">${catOptions}</select>
        </div>
        <div class="submit-field">
          <label for="f-content">${esc(t(lang, "submit_label_content"))}</label>
          <textarea id="f-content" name="content" required placeholder="${esc(t(lang, "submit_placeholder_content"))}">${esc(v.content || "")}</textarea>
          <div class="hint">${esc(t(lang, "submit_content_hint"))}</div>
        </div>
        <div class="submit-field">
          <label for="f-evidence">${esc(t(lang, "submit_label_evidence"))}</label>
          <input type="text" id="f-evidence" name="evidence" value="${esc(v.evidence || "")}" placeholder="${esc(t(lang, "submit_placeholder_evidence"))}" maxlength="2000">
        </div>
        <div class="submit-actions">
          <button type="submit" class="submit-btn">${esc(t(lang, "submit_btn"))}</button>
          <a class="submit-back" href="${prefix}/">${esc(t(lang, "submit_go_back"))}</a>
        </div>
      </form>
    </div>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(page, { status: opts.status || 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const CHAPTER_WORD = {
  "zh-Hant": (n) => `第${n}章`, "zh-Hans": (n) => `第${n}章`,
  "en": (n) => `Chapter ${n}`, "fr": (n) => `Chapitre ${n}`,
  "de": (n) => `Kapitel ${n}`, "ja": (n) => `第${n}章`,
  "eo": (n) => `Ĉapitro ${n}`, "es": (n) => `Capítulo ${n}`,
};

// 「第N章/回」這種固定格式的標題,直接查表產生,不靠AI翻譯,避免AI翻出「Chapter Third」「The Fifth Chapter」這類不一致的用詞
function chapterTitleLabel(lang, chapterNo, fallbackTitle) {
  if (!chapterNo || !/^第.+[章回]$/.test(fallbackTitle || "")) return null;
  const fn = CHAPTER_WORD[lang];
  return fn ? fn(chapterNo) : null;
}

async function getChapterTitleT(env, id, lang, chapterNo, original, bypassZhEnPair) {
  const fixed = chapterTitleLabel(lang, chapterNo, original);
  if (fixed) return fixed;
  return getOrTranslate(env, "literature", id, lang, "chapter_title", original, undefined, bypassZhEnPair);
}

async function renderLiteratureList(env, lang, url) {
  const { results: allResults } = await env.DB.prepare(
    "SELECT id, series_title, chapter_no, chapter_title, title, category, author, publish_date, source_lang FROM literature ORDER BY series_title IS NULL, series_title, chapter_no"
  ).all();

  const today = new Date().toISOString().slice(0, 10);
  const visibleResults = allResults.filter((r) => !r.publish_date || r.publish_date <= today);

  const activeCategory = url ? url.searchParams.get("category") : null;
  const results = activeCategory
    ? visibleResults.filter((r) => r.category === activeCategory)
    : visibleResults;

  const groups = {};
  const standalone = [];
  for (const row of results) {
    if (row.series_title) {
      if (!groups[row.series_title]) groups[row.series_title] = [];
      groups[row.series_title].push(row);
    } else {
      standalone.push(row);
    }
  }

  const prefix = langPrefix(lang);
  let html = "";
  for (const seriesTitle of Object.keys(groups)) {
    const chapters = groups[seriesTitle];
    const first = chapters[0];
    const seriesSourceLang = first.source_lang || "zh";
    // V74: 非世界名著系列(原創投稿等)在英文頁照常翻譯,不再被「中英互不翻譯」規則擋下
    const seriesTitleT = await getOrTranslate(env, "literature_series", 0, lang, seriesTitle, seriesTitle, seriesSourceLang, first.category !== "世界名著");
    const chapterTitlesT = await mapWithConcurrency(chapters, 1, (c) => {
      const original = c.chapter_title || ("第" + c.chapter_no + "回");
      const fixed = chapterTitleLabel(lang, c.chapter_no, original);
      if (fixed) return Promise.resolve(fixed);
      // V74: 非世界名著章節在英文頁照常翻譯(世界名著保留正式雙語版本設計)
      return getOrTranslate(env, "literature", c.id, lang, "chapter_title", original, c.source_lang || "zh", c.category !== "世界名著");
    });
    html += `
      <section class="lit-series">
        <h2>${escapeHtml(seriesTitleT)}</h2>
        <p class="lit-meta">${escapeHtml(t(lang, "lit_author"))}:${escapeHtml(first.author || "")} | ${escapeHtml(t(lang, "lit_category"))}:${escapeHtml(catLabel(lang, first.category))}</p>
        <ul class="lit-chapters">
          ${chapters.map((c, i) => `<li><a href="${prefix}/literature/read?id=${c.id}">${escapeHtml(chapterTitlesT[i])}</a></li>`).join("")}
        </ul>
      </section>
    `;
  }

  if (standalone.length) {
    const standaloneTitlesT = await mapWithConcurrency(standalone, 1, (s) =>
      // V74: 非世界名著單篇在英文頁照常翻譯
      getOrTranslate(env, "literature", s.id, lang, "title", s.title, s.source_lang || "zh", s.category !== "世界名著")
    );
    html += `
      <section class="lit-series">
        <h2>${escapeHtml(t(lang, "lit_standalone"))}</h2>
        <ul class="lit-chapters">
          ${standalone.map((s, i) => `<li><a href="${prefix}/literature/read?id=${s.id}">${escapeHtml(standaloneTitlesT[i])}</a> <span class="lit-meta">— ${escapeHtml(s.author || "")}</span></li>`).join("")}
        </ul>
      </section>
    `;
  }

  if (!html) html = `<p>${escapeHtml(t(lang, "news_no_data"))}</p>`;

  const page = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t(lang, "lit_page_title"))} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: t(lang, "lit_page_title") + " - SY Horizon", description: t(lang, "lit_page_subtitle"), path: "/literature", lang })}
<style>
  ${BASE_STYLE}
  .lit-series { margin-bottom: 2.5rem; }
  .lit-series h2 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
  .lit-meta { color: #888; font-size: 0.85rem; margin: 0.3rem 0 1rem 0; }
  .lit-cats { margin: 0.3rem 0 1.5rem 0; }
  .lit-cats a {
    color: #555; text-decoration: none; margin-right: 1.2rem; font-size: 0.9rem;
    padding-bottom: 2px; border-bottom: 2px solid transparent;
  }
  .lit-cats a:hover { color: #1a4fa0; }
  .lit-cats a.lit-cat-active { color: #1a4fa0; border-bottom-color: #1a4fa0; font-weight: 600; }
  .lit-chapters { list-style: none; padding: 0; }
  .lit-chapters li { padding: 0.5rem 0; border-bottom: 1px solid #ddd; }
  .lit-chapters a { color: #1a4fa0; text-decoration: none; }
  .lit-chapters a:hover { text-decoration: underline; }
</style>
</head>
<body>
  ${buildNav(lang, "/literature")}
  <div class="content-wrap">
    <h1>${escapeHtml(t(lang, "lit_page_title"))}</h1>
    <p class="lit-cats">
      <a href="${prefix}/literature" class="${!activeCategory ? "lit-cat-active" : ""}">${escapeHtml(t(lang, "lit_all"))}</a>
      ${["世界名著", "原創投稿", "各抒己見"].map((c) =>
        `<a href="${prefix}/literature?category=${encodeURIComponent(c)}" class="${activeCategory === c ? "lit-cat-active" : ""}">${escapeHtml(catLabel(lang, c))}</a>`
      ).join("")}
    </p>
    ${html}
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function renderLiteratureItem(url, env, lang) {
  const id = url.searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const row = await env.DB.prepare("SELECT * FROM literature WHERE id = ?").bind(id).first();
  if (!row) return new Response("Not Found", { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  if (row.publish_date && row.publish_date > today) {
    return new Response("Not Found", { status: 404 });
  }

  const isClassic = row.category === "世界名著";
  const skipTranslate = isClassic;

  const originalTitle = row.chapter_title || row.title;
  const displayTitle = skipTranslate
    ? (chapterTitleLabel(lang, row.chapter_no, originalTitle) || originalTitle)
    : await getChapterTitleT(env, row.id, lang, row.chapter_no, originalTitle, !isClassic);
  const translatedContent = skipTranslate
    ? (row.content || "")
    : await getOrTranslate(env, "literature", row.id, lang, "content", row.content || "", row.source_lang || "zh", !isClassic);
  const seriesTitleT = row.series_title
    ? (skipTranslate ? row.series_title : await getOrTranslate(env, "literature_series", 0, lang, row.series_title, row.series_title, "zh", !isClassic))
    : "";

  const paragraphs = (translatedContent || "")
    .split(/\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("");

  const prefix = langPrefix(lang);
  const backLine = `<p class="lit-meta"><a href="${prefix}/literature">← ${escapeHtml(t(lang, "lit_back"))}</a>${seriesTitleT ? " | " + escapeHtml(seriesTitleT) : ""}</p>`;
  const itemDescription = (translatedContent || "").replace(/\n+/g, " ").slice(0, 150);

  const page = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(displayTitle)} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: displayTitle + " - SY Horizon", description: itemDescription, path: "/literature/read?id=" + row.id, lang, type: "article" })}
<style>
  ${BASE_STYLE}
  .lit-meta { color: #888; font-size: 0.85rem; }
  .lit-meta a { color: #1a4fa0; text-decoration: none; }
  .lit-content { line-height: 2; font-size: 1.05rem; }
  .lit-content p { margin: 0 0 1rem 0; text-indent: 2em; }
  .lit-author { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
</style>
</head>
<body>
  ${buildNav(lang, "/literature")}
  <div class="content-wrap">
    ${backLine}
    <h1>${escapeHtml(displayTitle)}</h1>
    ${!skipTranslate ? englishFallbackNote(lang, translatedContent) : ""}
    <p class="lit-author">${escapeHtml(t(lang, "lit_author"))}:${escapeHtml(row.author || "")} | ${escapeHtml(t(lang, "lit_category"))}:${escapeHtml(catLabel(lang, row.category))}</p>
    <div class="lit-content">${paragraphs}</div>
    ${backLine}
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function renderPlaceholder(title, message, lang, remainder) {
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} - ${escapeHtml(t(lang, "site_name"))}</title>
<style>${BASE_STYLE}</style>
</head>
<body>
  ${buildNav(lang, remainder)}
  <div class="content-wrap">
    <div class="placeholder">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </div>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function renderGuideList(env, lang) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, topic FROM guides ORDER BY id"
  ).all();

  const prefix = langPrefix(lang);
  const titlesT = await mapWithConcurrency(results, 1, (g) =>
    getOrTranslate(env, "guide", g.id, lang, "title", g.title)
  );
  let itemsHtml = results
    .map((g, i) => `<li><a href="${prefix}/guide/read?id=${g.id}">${escapeHtml(titlesT[i])}</a></li>`)
    .join("");
  if (!itemsHtml) itemsHtml = `<p>${escapeHtml(t(lang, "news_no_data"))}</p>`;
  // V74: 英文頁若全部標題都仍是中文(翻譯失敗回退),顯示「coming soon」提示,避免訪客以為頁面壞掉
  const listNoteHtml = (lang === "en" && results.length > 0 && titlesT.every((t) => containsCjk(t)))
    ? `<div class="en-fallback-note">🌐 English version coming soon — showing the original Chinese titles for now.</div>`
    : "";

  const page = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t(lang, "nav_guide"))} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: t(lang, "nav_guide") + " - SY Horizon", description: "生活實用工具與避坑指南整理", path: "/guide", lang })}
<style>
  ${BASE_STYLE}
  .lit-chapters { list-style: none; padding: 0; }
  .lit-chapters li { padding: 0.6rem 0; border-bottom: 1px solid #ddd; }
  .lit-chapters a { color: #1a4fa0; text-decoration: none; font-size: 1.05rem; }
  .lit-chapters a:hover { text-decoration: underline; }
</style>
</head>
<body>
  ${buildNav(lang, "/guide")}
  <div class="content-wrap">
    <h1>${escapeHtml(t(lang, "nav_guide"))}</h1>
    ${listNoteHtml}
    <ul class="lit-chapters">${itemsHtml}</ul>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function renderGuideItem(url, env, lang) {
  const id = url.searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const row = await env.DB.prepare("SELECT * FROM guides WHERE id = ?").bind(id).first();
  if (!row) return new Response("Not Found", { status: 404 });

  const displayTitle = await getOrTranslate(env, "guide", row.id, lang, "title", row.title);
  const translatedContent = await getOrTranslate(env, "guide", row.id, lang, "content", row.content || "");

  const prefix = langPrefix(lang);
  const paragraphs = (translatedContent || "")
    .split(/\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("");
  const guideDescription = (translatedContent || "").replace(/\n+/g, " ").slice(0, 150);

  const page = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(displayTitle)} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: displayTitle + " - SY Horizon", description: guideDescription, path: "/guide/read?id=" + row.id, lang, type: "article" })}
<style>
  ${BASE_STYLE}
  .lit-meta { color: #888; font-size: 0.85rem; }
  .lit-meta a { color: #1a4fa0; text-decoration: none; }
  .lit-content { line-height: 2; font-size: 1.05rem; }
  .lit-content p { margin: 0 0 1rem 0; text-indent: 2em; }
</style>
</head>
<body>
  ${buildNav(lang, "/guide")}
  <div class="content-wrap">
    <p class="lit-meta"><a href="${prefix}/guide">← ${escapeHtml(t(lang, "nav_guide"))}</a></p>
    <h1>${escapeHtml(displayTitle)}</h1>
    ${englishFallbackNote(lang, translatedContent)}
    <div class="lit-content">${paragraphs}</div>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function renderAuthorPage(env, lang) {
  const author = await env.DB.prepare("SELECT * FROM authors WHERE slug = ?").bind("shengyan").first();
  if (!author) return new Response("Not Found", { status: 404 });

  // V74: 作者簡介與專長在英文頁也走翻譯管線(失敗時自動回退中文原文,不會空白)
  const authorKey = author.id || author.slug || "shengyan";
  const displayBio = await getOrTranslate(env, "author", authorKey, lang, "bio", author.bio || "");
  const displayExpertise = await getOrTranslate(env, "author", authorKey, lang, "expertise", author.expertise || "");

  const bioParagraphs = (displayBio || "")
    .split(/\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("");

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(author.name)} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: author.name + " - SY Horizon", description: displayExpertise || displayBio || "", path: "/author/shengyan", lang, type: "profile" })}
<style>
  ${BASE_STYLE}
  .author-header { display: flex; align-items: center; gap: 1.5rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .author-avatar { width: 400px; height: auto; max-width: 100%; max-height: 80vh; object-fit: contain; border-radius: 8px; background: #fff; flex-shrink: 0; }
  .author-name { margin: 0 0 0.3rem 0; }
  .author-expertise { color: #1a4fa0; font-size: 0.95rem; margin: 0; }
  .author-bio p { line-height: 1.9; margin: 0 0 1rem 0; }
  .author-contact { margin-top: 2rem; color: #666; font-size: 0.9rem; }
  .author-contact a { color: #1a4fa0; }
</style>
</head>
<body>
  ${buildNav(lang, "/author/shengyan")}
  <div class="content-wrap">
    <div class="author-header">
      <img class="author-avatar" src="${escapeHtml(author.avatar_url || "")}" alt="${escapeHtml(author.name)}">
      <div>
        <h1 class="author-name">${escapeHtml(author.name)}</h1>
        <p class="author-expertise">${escapeHtml(displayExpertise || "")}</p>
      </div>
    </div>
    ${englishFallbackNote(lang, displayBio)}
    <div class="author-bio">${bioParagraphs}</div>
    <p class="author-contact">聯絡方式：<a href="mailto:${escapeHtml(author.contact_email || "")}">${escapeHtml(author.contact_email || "")}</a></p>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function renderAboutPage(lang) {
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t(lang, "nav_about"))} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: t(lang, "nav_about") + " - SY Horizon", description: "SY Horizon 追蹤全球時事、金融脈動、科技趨勢，並發展原創報告文學與世界名著翻譯內容。", path: "/about", lang })}
<style>
  ${BASE_STYLE}
  .about-section { margin-bottom: 2.5rem; }
  .about-section h2 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
  .about-block { margin-bottom: 1.5rem; }
  .about-block h3 { color: #1a4fa0; margin-bottom: 0.3rem; }
  .about-block p { line-height: 1.8; margin: 0 0 0.8rem 0; }
  .about-block a { color: #1a4fa0; }
</style>
</head>
<body>
  ${buildNav(lang, "/about")}
  <div class="content-wrap">
    <h1>關於我們 / About Us</h1>

    <section class="about-section">
      <h2>創作初衷 / Our Vision</h2>
      <div class="about-block">
        <h3>中文</h3>
        <p>在信息紛繁的時代,我們創立「SY 視野 (SY Horizon)」的初衷,是為讀者提供一個冷靜、獨立且深度的觀察窗口。我深信,每一個被記錄的社會切片,背後都蘊含著對法治與人性的深刻考量。我們致力於追蹤全球動態,從金融脈動到科技前沿,從紀實調查到人文敘事,旨在通過多元的視角,還原世界的複雜與真實。我們秉持「君子不可無錢,取之必須有道」的原則,用文字記錄時代,用鏡頭捕捉真理,力求在碎片化的閱讀中,為您呈現有分量、有溫度、有深度的內容。</p>
      </div>
      <div class="about-block">
        <h3>English</h3>
        <p>In an era of overwhelming information, we established "SY Horizon" with a singular mission: to provide a calm, independent, and insightful window into the world. I firmly believe that behind every documented slice of society lies a profound reflection on the rule of law and human nature. We are committed to tracking global developments—from financial fluctuations to technological frontiers, and from investigative inquiries to humanistic narratives. By adopting diverse perspectives, we strive to reveal the complexity and truth of our world. Guided by the principle that "a gentleman must have money, but must obtain it in a righteous way," we record the era through our words and capture truths through our lenses, aiming to present you with content of substance, warmth, and depth amidst the noise of fragmented reading.</p>
      </div>
    </section>

    <section class="about-section">
      <h2>聯繫方式 / Contact Information</h2>
      <div class="about-block">
        <p>如有任何合作意向、內容反饋或諮詢,歡迎通過以下官方渠道與我們聯繫。我們將盡快為您回覆。</p>
        <p>工作郵箱 / Business Email: <a href="mailto:biz@sylogs.com">biz@sylogs.com</a></p>
      </div>
    </section>

    <section class="about-section">
      <h2>隱私聲明 / Privacy Policy</h2>
      <div class="about-block">
        <p>我們高度重視您的隱私安全。在使用本網站的過程中,我們承諾採取以下原則保護您的個人信息:</p>
        <h3>中文</h3>
        <p>1. 信息收集:本站僅收集必要的訪問統計數據,旨在優化您的閱讀體驗。<br>
        2. 數據保護:我們不會向任何第三方出售、分享或洩露您的個人信息。<br>
        3. 信息透明:如果您選擇通過郵件與我們聯繫,我們僅會將您的聯繫信息用於業務溝通。<br>
        4. 法律合規:我們將嚴格遵循適用的隱私法規,保障您的數字權益。</p>
        <h3>English</h3>
        <p>1. Data Collection: We collect only essential traffic statistics to improve your reading experience.<br>
        2. Data Protection: We do not sell, share, or disclose your personal information to any third parties.<br>
        3. Transparency: If you choose to contact us via email, your contact information will be used solely for business communication.<br>
        4. Legal Compliance: We strictly adhere to applicable privacy regulations to safeguard your digital rights.</p>
      </div>
    </section>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}


// 政策類頁面共用渲染函式(編輯政策/隱私政策等),content欄位存的是站方自行撰寫的可信HTML,直接輸出不做escape
async function renderPolicyPage(env, lang, slug, navPath) {
  const page = await env.DB.prepare("SELECT * FROM policy_pages WHERE slug = ?").bind(slug).first();
  if (!page) return new Response("Not Found", { status: 404 });

  const isPricing = slug === "pricing";
  // V76-4: 固定頁面(pricing)在英文版使用「靜態英文字典」— 100%秒開英文、
  // 零AI/DeepL呼叫、永不觸發「English version coming soon」降級提示;
  // 中文版與其他語言維持既有路徑(資料庫內容 + AI翻譯 + 回退),輸出與舊版完全一致
  const enDict = (I18N && I18N["en"]) || {};
  const useStaticEn = lang === "en" && isPricing && !!enDict.pricing_title && !!enDict.pricing_content_html;
  const displayTitle = useStaticEn ? enDict.pricing_title
    : await getOrTranslate(env, "policy_pages", slug, lang, "title", page.title || "");
  const displayContent = useStaticEn ? enDict.pricing_content_html
    : await translateHtmlPreservingTags(env, "policy_pages", slug, lang, page.content || "");
  const policyDescription = (displayContent || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
  // V76-2: 英文頁若正文/標題仍為中文(翻譯降級),顯示 coming soon 提示;中文頁為空字串不輸出
  const fallbackNoteHtml = useStaticEn ? "" : englishFallbackNote(lang, String(displayContent) + " " + String(displayTitle));
  // V75-FIX: 付款區塊的靜態文字走 i18n 字典(/en/ 時自動切換為英文)
  const paypalButtonHtml = isPricing
    ? `
    <div class="paypal-pay-block">
      <h2>${escapeHtml(t(lang, "policy_paypal_title"))}</h2>
      <p>${escapeHtml(t(lang, "policy_paypal_desc"))}</p>
      <div>
        <style>.pp-X5AG3KESRJBP4{text-align:center;border:none;border-radius:0.25rem;min-width:11.625rem;padding:0 2rem;height:2.625rem;font-weight:bold;background-color:#FFD140;color:#000000;font-family:"Helvetica Neue",Arial,sans-serif;font-size:1rem;line-height:1.25rem;cursor:pointer;}</style>
        <form action="https://www.paypal.com/ncp/payment/X5AG3KESRJBP4" method="post" target="_blank" style="display:inline-grid;justify-items:center;align-content:start;gap:0.5rem;">
          <input class="pp-X5AG3KESRJBP4" type="submit" value="${escapeHtml(t(lang, "policy_pay_now"))}" />
          <img src="https://www.paypalobjects.com/images/Debit_Credit_APM.svg" alt="cards" />
          <section style="font-size: 0.75rem;"> ${escapeHtml(t(lang, "policy_paypal_support"))} <img src="https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-wordmark-color.svg" alt="paypal" style="height:0.875rem;vertical-align:middle;"/></section>
        </form>
      </div>
    </div>
    <div class="paypal-pay-block">
      <h2>${escapeHtml(t(lang, "policy_crypto_title"))}</h2>
      <p>${escapeHtml(t(lang, "policy_crypto_desc"))}</p>
      <div class="crypto-widgets">
        <div class="crypto-widget-item">
          <h3>${escapeHtml(t(lang, "policy_plan_once"))}</h3>
          <iframe src="https://nowpayments.io/embeds/payment-widget?iid=5945701073" width="410" height="696" frameborder="0" scrolling="no" style="overflow-y:hidden;max-width:100%;">Can't load widget</iframe>
        </div>
        <div class="crypto-widget-item">
          <h3>${escapeHtml(t(lang, "policy_plan_monthly"))}</h3>
          <iframe src="https://nowpayments.io/embeds/payment-widget?iid=5330709355" width="410" height="696" frameborder="0" scrolling="no" style="overflow-y:hidden;max-width:100%;">Can't load widget</iframe>
        </div>
        <div class="crypto-widget-item">
          <h3>${escapeHtml(t(lang, "policy_plan_lifetime"))}</h3>
          <iframe src="https://nowpayments.io/embeds/payment-widget?iid=6274159522" width="410" height="696" frameborder="0" scrolling="no" style="overflow-y:hidden;max-width:100%;">Can't load widget</iframe>
        </div>
      </div>
    </div>
    `
    : "";

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(displayTitle)} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: displayTitle + " - SY Horizon", description: policyDescription, path: navPath, lang })}
<style>
  ${BASE_STYLE}
  .policy-content h2 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; margin-top: 2.2rem; }
  .policy-content p { line-height: 1.9; margin: 0 0 1rem 0; }
  .policy-content ul { line-height: 1.9; margin: 0 0 1rem 0; padding-left: 1.5rem; }
  .policy-content li { margin-bottom: 0.4rem; }
  .policy-content a { color: #1a4fa0; }
  .paypal-pay-block { margin-top: 2rem; padding: 1.5rem; background: #fff; border: 1px solid #ddd; border-radius: 8px; }
  .paypal-pay-block h2 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; margin-top: 0; }
  .crypto-widgets { display: flex; flex-wrap: wrap; gap: 1.5rem; margin-top: 1rem; }
  .crypto-widget-item { flex: 1 1 300px; }
  .crypto-widget-item h3 { font-size: 0.95rem; margin: 0 0 0.5rem 0; color: #1a4fa0; }
</style>
</head>
<body>
  ${buildNav(lang, navPath)}
  <div class="content-wrap">
    <h1>${escapeHtml(displayTitle)}</h1>
    ${fallbackNoteHtml ? fallbackNoteHtml + "\n" : ""}<div class="policy-content">${displayContent}</div>
    ${paypalButtonHtml}
  </div>
  ${buildFooter(lang)}
</body>
</html>`;


  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ===== 兌換碼機制:付費工具存取控制,不使用帳號密碼 =====
const SESSION_COOKIE_NAME = "sy_access";
const SESSION_DURATION_DAYS = 365; // 兌換一次,一年內免重複輸入

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function generateToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

// 檢查訪客是否已對指定工具擁有有效的存取憑證
async function hasValidAccess(request, env, toolSlug) {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (!token) return false;
  const session = await env.DB.prepare(
    "SELECT * FROM access_sessions WHERE token = ? AND tool_slug = ? AND expires_at > datetime('now')"
  ).bind(token, toolSlug).first();
  return !!session;
}

const GLOBALEASE_SLUG = "overseas-life-guide";

const GLOBALEASE_PROMPTS = {
  document: (input) => `你是一位專業的海外生活文書助手。請根據以下需求，用英文起草一封正式、專業、符合當地禮儀規範的信件。\n\n信件類型：${input.docType || ""}\n具體需求：${input.details || ""}\n\n請直接輸出信件全文（英文），包含稱謂與結尾，不要加任何前言、標籤或說明文字。`,
  scam: (input) => `你是一位海外防騙顧問。使用者提供了一個想查詢風險的對象（網址／電話／機構名稱）：${input.target || ""}\n\n請注意，你沒有即時查證工具，無法確認這個對象是否真的存在詐騙行為，不可以對此對象做出「這是/不是詐騙」的武斷結論。請用繁體中文提供：\n1. 針對這類查詢對象，一般需要留意的常見詐騙特徵與風險信號（例如未登記備案、要求預付款、聯繫方式異常等一般性原則）\n2. 使用者應該如何自行查證（如查當地商業註冊網站、搜尋評價、透過官方管道核實）\n\n語氣請用「通常」「建議留意」等，不要用確定語氣描述使用者提供的具體對象。`,
  grocery: (input) => `你是一位海外生活省錢顧問。使用者想了解「${input.item || ""}」這項商品的比價建議。\n\n請注意你沒有即時價格資料庫，不可以捏造具體價格數字當作事實呈現。請用繁體中文提供：\n1. 這類商品在Costco、Walmart、當地超市等不同通路的價格與品質權衡的常見經驗法則（用「通常」「一般來說」等語氣）\n2. 省錢的實用建議（會員日、大宗購買、比價APP等）`,
  emergency: (input) => `你是一位海外生活應急顧問。使用者遇到的狀況：${input.situation || ""}\n\n請用繁體中文提供清楚、條理分明的應對步驟指引（例如安全確認、證據保留、聯繫相關單位等一般性原則）。如果情況涉及生命危險或嚴重醫療緊急狀況，請務必在最前面提醒使用者立即撥打當地緊急電話。請勿提供具體的法律或醫療診斷結論，只提供一般性程序指引，並建議使用者進一步諮詢專業人士（律師／醫生／保險公司）。`,
};

async function handleGlobalEaseGenerate(request, env) {
  // ===== V73: 付費工具 API 權限檢查 — 7 天試用期內或已付費(兌換碼)皆允許使用 =====
  let ok = await hasValidAccess(request, env, GLOBALEASE_SLUG);
  if (!ok) {
    const trial = await checkTrialAccess(request, env);
    ok = trial.ok;
  }
  if (!ok) {
    return new Response(JSON.stringify({ error: "未取得使用權限，請先登入免費試用或完成兌換。" }), {
      status: 403,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "請求格式錯誤" }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const { tool, input } = body || {};
  const promptFn = GLOBALEASE_PROMPTS[tool];
  if (!promptFn) {
    return new Response(JSON.stringify({ error: "不支援的工具類型" }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  try {
    const aiResp = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
      messages: [{ role: "user", content: promptFn(input || {}) }],
      max_tokens: 800,
    });
    const result = extractAiText2(aiResp);
    if (!result) {
      return new Response(JSON.stringify({ error: "生成失敗，請稍後再試。" }), { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    return new Response(JSON.stringify({ result }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (e) {
    await logDebug(env, "globalease_error", JSON.stringify({ tool, error: e.message }));
    return new Response(JSON.stringify({ error: "生成失敗，請稍後再試。" }), { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
}

async function handleMediaDownload(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "請求格式錯誤" }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const videoUrl = (body && body.url || "").trim();
  if (!videoUrl) {
    return new Response(JSON.stringify({ error: "請輸入影片網址" }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  try {
    const apiResp = await fetch(`https://${env.RAPIDAPI_HOST}/all`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-rapidapi-host": env.RAPIDAPI_HOST,
        "x-rapidapi-key": env.RAPIDAPI_KEY,
      },
      body: new URLSearchParams({ url: videoUrl, cookies: "", cookies_file: "" }).toString(),
    });
    const data = await apiResp.json();
    await logDebug(env, "media_download_result", JSON.stringify({ url: videoUrl, ok: apiResp.ok, status: apiResp.status, bodyPreview: JSON.stringify(data).slice(0, 300) }));
    if (!apiResp.ok) {
      return new Response(JSON.stringify({ error: "下載服務暫時無法使用，請稍後再試。" }), { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (e) {
    await logDebug(env, "media_download_error", JSON.stringify({ url: videoUrl, error: e.message }));
    return new Response(JSON.stringify({ error: "下載服務暫時無法使用，請稍後再試。" }), { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
}

function renderFreePage(lang) {
  const prefix = langPrefix(lang);
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t(lang, "free_page_title"))} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: t(lang, "free_page_title") + " - SY Horizon", description: t(lang, "free_meta_desc"), path: "/free", lang })}
<style>
  ${BASE_STYLE}
  .free-section { margin-bottom: 2.5rem; }
  .free-section h2 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
  .free-section ul { line-height: 2.2; padding-left: 1.5rem; }
  .free-section a { color: #1a4fa0; text-decoration: none; }
  .free-section a:hover { text-decoration: underline; }
  .free-badge { display: inline-block; background: #e8f5e9; color: #2e7d32; font-size: 0.75rem; padding: 0.1rem 0.6rem; border-radius: 10px; margin-left: 0.5rem; }
</style>
</head>
<body>
  ${buildNav(lang, "/free")}
  <div class="content-wrap">
    <h1>${escapeHtml(t(lang, "free_h1"))}<span class="free-badge">${escapeHtml(t(lang, "free_all_badge"))}</span></h1>
    <p>${escapeHtml(t(lang, "free_intro"))}</p>

    <section class="free-section">
      <h2>${escapeHtml(t(lang, "free_tools_title"))}</h2>
      <ul>
        <li><a href="${prefix}/tools/life/unit-converter">${escapeHtml(t(lang, "tool_unit_converter_name"))}</a></li>
        <li><a href="${prefix}/tools/office/bookmark-cleaner">${escapeHtml(t(lang, "tool_bookmark_cleaner_name"))}</a></li>
        <li><a href="${prefix}/tools/office/url-shortener">${escapeHtml(t(lang, "tool_url_shortener_name"))}</a></li>
        <li><a href="${prefix}/tools/writing/word-counter">${escapeHtml(t(lang, "tool_word_counter_name"))}</a></li>
        <li><a href="${prefix}/tools/writing/tc-sc-converter">${escapeHtml(t(lang, "tool_tc_sc_converter_name"))}</a></li>
        <li><a href="${prefix}/tools/writing/text-to-speech">${escapeHtml(t(lang, "tool_text_to_speech_name"))}</a></li>
      </ul>
    </section>

    <section class="free-section">
      <h2>${escapeHtml(t(lang, "nav_literature"))}</h2>
      <p><a href="${prefix}/literature">${escapeHtml(t(lang, "free_browse_literature"))}</a>${escapeHtml(t(lang, "free_lit_note"))}</p>
    </section>

    <section class="free-section">
      <h2>${escapeHtml(t(lang, "nav_news"))}</h2>
      <p><a href="${prefix}/news">${escapeHtml(t(lang, "free_browse_news"))}</a>${escapeHtml(t(lang, "free_news_note"))}</p>
    </section>

    <section class="free-section">
      <h2>${escapeHtml(t(lang, "nav_guide"))}</h2>
      <p><a href="${prefix}/guide">${escapeHtml(t(lang, "free_browse_guide"))}</a></p>
    </section>

    <section class="free-section">
      <h2>${escapeHtml(t(lang, "nav_media"))}</h2>
      <p><a href="${prefix}/media">${escapeHtml(t(lang, "free_browse_media"))}</a></p>
    </section>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ===== Email 驗證碼登入(免密碼) =====
const USER_SESSION_COOKIE = "sy_user";
const LOGIN_CODE_DURATION_MIN = 10;
const USER_SESSION_DURATION_DAYS = 30;

function generateLoginCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6位數字
}

async function sendVerificationEmail(env, email, code) {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "SY Horizon <biz@sylogs.com>",
        to: [email],
        subject: "您的登入驗證碼 - SY Horizon",
        html: `<p>您的登入驗證碼是：</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p><p>此驗證碼 ${LOGIN_CODE_DURATION_MIN} 分鐘內有效，請勿將驗證碼提供給他人。</p><p>如果這不是您本人的操作，請忽略此郵件。</p>`,
      }),
    });
    const bodyText = await resp.text();
    await logDebug(env, "resend_send_result", JSON.stringify({
      email, ok: resp.ok, status: resp.status, body: bodyText.slice(0, 300),
      hasKey: !!env.RESEND_API_KEY,
    }));
    return resp.ok;
  } catch (e) {
    await logDebug(env, "resend_send_error", JSON.stringify({ email, error: e.message, hasKey: !!env.RESEND_API_KEY }));
    return false;
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function renderLoginPage(request, env, lang, url) {
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const action = url.searchParams.get("action");
  const inputCode = url.searchParams.get("code");
  let message = "";
  let messageType = "";
  let step = "email"; // email | code

  if (action === "send" && email) {
    if (!isValidEmail(email)) {
      message = "請輸入正確的Email格式。";
      messageType = "error";
    } else {
      const code = generateLoginCode();
      const expiresAt = new Date(Date.now() + LOGIN_CODE_DURATION_MIN * 60 * 1000).toISOString();
      await env.DB.prepare("INSERT INTO login_codes (email, code, expires_at) VALUES (?, ?, ?)").bind(email, code, expiresAt).run();
      const sent = await sendVerificationEmail(env, email, code);
      if (sent) {
        step = "code";
        message = `驗證碼已寄到 ${email}，請查收（含垃圾郵件匣）。`;
        messageType = "success";
      } else {
        message = "驗證碼寄送失敗，請稍後再試。";
        messageType = "error";
      }
    }
  } else if (email && inputCode) {
    const codeRow = await env.DB.prepare(
      "SELECT * FROM login_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1"
    ).bind(email, inputCode.trim()).first();

    if (!codeRow) {
      step = "code";
      message = "驗證碼錯誤或已過期，請重新輸入或重新發送。";
      messageType = "error";
    } else {
      await env.DB.prepare("UPDATE login_codes SET used = 1 WHERE id = ?").bind(codeRow.id).run();

      let user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
      if (!user) {
        await env.DB.prepare("INSERT INTO users (email) VALUES (?)").bind(email).run();
        user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
        // ===== V73: 新註冊用戶自動享有 7 天免費付費工具試用 =====
        // 試用到期日以 created_at + 7 天判定(註冊當下即開始計時);
        // 若 users 表沒有 created_at 欄位,則寫入 trial_started_at 記錄試用起點,確保計時從註冊開始
        if (!user.created_at && !user.trial_started_at) {
          await env.DB.prepare("UPDATE users SET trial_started_at = datetime('now') WHERE id = ?").bind(user.id).run();
        }
      }

      const token = generateToken();
      const sessExpiresAt = new Date(Date.now() + USER_SESSION_DURATION_DAYS * 86400 * 1000).toISOString();
      await env.DB.prepare("INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, user.id, sessExpiresAt).run();

      const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
      headers.append("Set-Cookie", `${USER_SESSION_COOKIE}=${token}; Path=/; Max-Age=${USER_SESSION_DURATION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`);
      headers.append("Location", langPrefix(lang) + "/");
      return new Response(null, { status: 302, headers });
    }
  } else if (email) {
    step = "code";
  }

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登錄/註冊 - ${escapeHtml(t(lang, "site_name"))}</title>
<meta name="robots" content="noindex,nofollow">
<style>
  ${BASE_STYLE}
  .login-box { max-width: 420px; margin: 3rem auto; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 2rem; }
  .login-box h1 { font-size: 1.3rem; margin-top: 0; }
  .login-box input { width: 100%; padding: 0.7rem; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; box-sizing: border-box; margin-bottom: 1rem; }
  .login-box button { width: 100%; padding: 0.7rem; background: #1a4fa0; color: #fff; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; }
  .login-box button:hover { background: #123a78; }
  .login-msg { padding: 0.7rem; border-radius: 4px; margin-bottom: 1rem; font-size: 0.9rem; }
  .login-msg.error { background: #fdecea; color: #a61b1b; }
  .login-msg.success { background: #e8f5e9; color: #2e7d32; }
  .login-note { font-size: 0.8rem; color: #888; margin-top: 1rem; }
</style>
</head>
<body>
  ${buildNav(lang, "/login")}
  <div class="content-wrap">
    <div class="login-box">
      <h1>登錄 / 註冊</h1>
      ${message ? `<div class="login-msg ${messageType}">${escapeHtml(message)}</div>` : ""}
      ${step === "email" ? `
        <form method="GET" action="${langPrefix(lang)}/login">
          <input type="hidden" name="action" value="send">
          <input type="email" name="email" placeholder="請輸入您的Email" required value="${escapeHtml(email)}">
          <button type="submit">發送驗證碼</button>
        </form>
        <p class="login-note">不需要密碼。輸入Email後，我們會寄送一組6位數驗證碼給您，用驗證碼即可完成登入或註冊。</p>
      ` : `
        <form method="GET" action="${langPrefix(lang)}/login">
          <input type="hidden" name="email" value="${escapeHtml(email)}">
          <input type="text" name="code" placeholder="請輸入6位數驗證碼" maxlength="6" required>
          <button type="submit">驗證並登入</button>
        </form>
        <p class="login-note">沒收到驗證碼？<a href="${langPrefix(lang)}/login">重新開始</a></p>
      `}
    </div>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function renderRedeemPage(request, env, lang, url) {
  const toolSlug = url.searchParams.get("tool") || "overseas-life-guide";
  const inputCode = url.searchParams.get("code");
  let message = "";
  let messageType = "";

  if (inputCode) {
    const codeRow = await env.DB.prepare(
      "SELECT * FROM access_codes WHERE code = ? AND tool_slug = ?"
    ).bind(inputCode.trim(), toolSlug).first();

    if (!codeRow) {
      message = "兌換碼無效，請確認輸入是否正確。";
      messageType = "error";
    } else if (codeRow.is_used) {
      message = "這組兌換碼已經被使用過了。";
      messageType = "error";
    } else {
      // V79: 兌換碼時長可配置 — 以 access_codes.duration_days 為準(1個月=30 / 3個月=90 / 1年=365),
      // 缺省或無效值回退固定 365 天(與舊版行為一致,欄位未建也不影響既有兌換)
      const durationDays = (Number(codeRow.duration_days) > 0) ? Number(codeRow.duration_days) : SESSION_DURATION_DAYS;
      const token = generateToken();
      const expiresAt = new Date(Date.now() + durationDays * 86400 * 1000).toISOString();
      await env.DB.prepare("UPDATE access_codes SET is_used = 1, used_at = datetime('now') WHERE id = ?").bind(codeRow.id).run();
      await env.DB.prepare("INSERT INTO access_sessions (token, tool_slug, expires_at) VALUES (?, ?, ?)").bind(token, toolSlug, expiresAt).run();

      const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
      headers.append("Set-Cookie", `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${durationDays * 86400}; HttpOnly; Secure; SameSite=Lax`);
      headers.append("Location", langPrefix(lang) + "/tools/premium/" + toolSlug);
      return new Response(null, { status: 302, headers });
    }
  }

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>兌換碼 - ${escapeHtml(t(lang, "site_name"))}</title>
<meta name="robots" content="noindex,nofollow">
<style>
  ${BASE_STYLE}
  .redeem-box { max-width: 420px; margin: 3rem auto; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 2rem; }
  .redeem-box h1 { font-size: 1.3rem; margin-top: 0; }
  .redeem-box input { width: 100%; padding: 0.7rem; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; box-sizing: border-box; margin-bottom: 1rem; }
  .redeem-box button { width: 100%; padding: 0.7rem; background: #1a4fa0; color: #fff; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; }
  .redeem-box button:hover { background: #123a78; }
  .redeem-msg { padding: 0.7rem; border-radius: 4px; margin-bottom: 1rem; font-size: 0.9rem; }
  .redeem-msg.error { background: #fdecea; color: #a61b1b; }
</style>
</head>
<body>
  ${buildNav(lang, "/redeem")}
  <div class="content-wrap">
    <div class="redeem-box">
      <h1>輸入兌換碼</h1>
      ${message ? `<div class="redeem-msg ${messageType}">${escapeHtml(message)}</div>` : ""}
      <form method="GET" action="${langPrefix(lang)}/redeem">
        <input type="hidden" name="tool" value="${escapeHtml(toolSlug)}">
        <input type="text" name="code" placeholder="請輸入您收到的兌換碼" required>
        <button type="submit">兌換並開啟</button>
      </form>
    </div>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// 付費工具內容登記表,目前是空的,等實際工具檔案準備好後填入
const PREMIUM_TOOLS = {
  "overseas-life-guide": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>GlobalEase Assistant | \u6d77\u5916\u751f\u6d3b\u901a - \u667a\u80fd\u6d77\u5916\u751f\u6d3b\u52a9\u624b</title>\n    <style>\n        :root {\n            --primary: #2563eb;\n            --primary-dark: #1d4ed8;\n            --accent: #f59e0b;\n            --bg-color: #f8fafc;\n            --card-bg: #ffffff;\n            --text-main: #1e293b;\n            --text-muted: #64748b;\n            --border: #e2e8f0;\n        }\n        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif; }\n        body { background-color: var(--bg-color); color: var(--text-main); line-height: 1.6; }\n        \n        /* Header */\n        header { background: linear-gradient(135deg, #1e3a8a, #2563eb); color: white; padding: 2rem 1rem; text-align: center; position: relative; }\n        header h1 { font-size: 2.2rem; margin-bottom: 0.5rem; font-weight: 700; }\n        header p { font-size: 1.1rem; opacity: 0.9; max-width: 600px; margin: 0 auto; }\n        .lang-switch { position: absolute; top: 1.5rem; right: 1.5rem; background: rgba(255,255,255,0.2); border: none; color: white; padding: 0.5rem 1rem; border-radius: 20px; cursor: pointer; font-size: 0.9rem; }\n        .lang-switch:hover { background: rgba(255,255,255,0.3); }\n\n        /* Container */\n        .container { max-width: 1100px; margin: -30px auto 40px auto; padding: 0 1rem; position: relative; z-index: 10; }\n        \n        /* Dashboard Banner / Membership Card */\n        .dashboard-card { background: var(--card-bg); border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); padding: 1.5rem 2rem; margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; border: 1px solid var(--border); }\n        .user-status h3 { font-size: 1.2rem; color: var(--text-main); margin-bottom: 0.25rem; }\n        .user-status p { color: var(--text-muted); font-size: 0.95rem; }\n        .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600; background: #dbeafe; color: #1e40af; margin-left: 0.5rem; }\n        .badge.vip { background: #fef3c7; color: #d97706; }\n        .pricing-btn { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; cursor: pointer; transition: transform 0.2s; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3); }\n        .pricing-btn:hover { transform: translateY(-2px); }\n\n        /* Main Grid */\n        .main-grid { display: grid; grid-template-columns: 1fr 320px; gap: 2rem; }\n        @media(max-width: 850px) { .main-grid { grid-template-columns: 1fr; } }\n\n        /* Tools Section */\n        .tools-card { background: var(--card-bg); border-radius: 16px; padding: 2rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); border: 1px solid var(--border); }\n        .tabs { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; border-bottom: 2px solid var(--border); padding-bottom: 0.75rem; overflow-x: auto; }\n        .tab-btn { background: none; border: none; padding: 0.5rem 1rem; font-size: 1rem; font-weight: 600; color: var(--text-muted); cursor: pointer; border-radius: 6px; transition: all 0.2s; white-space: nowrap; }\n        .tab-btn.active { background: #eff6ff; color: var(--primary); }\n        \n        .tool-panel { display: none; }\n        .tool-panel.active { display: block; }\n        .tool-panel h2 { font-size: 1.4rem; margin-bottom: 0.5rem; color: var(--text-main); }\n        .tool-panel p.desc { color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1.5rem; }\n        \n        .form-group { margin-bottom: 1.25rem; }\n        label { display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 0.5rem; }\n        input, select, textarea { width: 100%; padding: 0.75rem 1rem; border: 1px solid var(--border); border-radius: 8px; font-size: 1rem; outline: none; transition: border-color 0.2s; }\n        input:focus, select:focus, textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }\n        \n        .action-btn { background: var(--primary); color: white; border: none; width: 100%; padding: 0.85rem; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }\n        .action-btn:hover { background: var(--primary-dark); }\n        \n        .result-box { margin-top: 1.5rem; background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; display: none; }\n        .result-box h4 { color: var(--primary); margin-bottom: 0.5rem; font-size: 1.05rem; }\n\n        /* Sidebar Pricing Plans */\n        .sidebar { display: flex; flex-direction: column; gap: 1.5rem; }\n        .pricing-card { background: var(--card-bg); border-radius: 16px; padding: 1.5rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); border: 1px solid var(--border); text-align: center; position: relative; overflow: hidden; }\n        .pricing-card.popular { border: 2px solid var(--accent); }\n        .pricing-card.popular::before { content: \"\u6700\u53d7\u6b22\u8fce / Most Popular\"; position: absolute; top: 12px; right: -30px; background: var(--accent); color: white; font-size: 0.7rem; font-weight: bold; padding: 4px 30px; transform: rotate(45deg); }\n        .price { font-size: 2rem; font-weight: 700; color: var(--primary); margin: 0.75rem 0; }\n        .price span { font-size: 0.9rem; font-weight: normal; color: var(--text-muted); }\n        .features-list { text-align: left; margin: 1rem 0; font-size: 0.9rem; color: var(--text-muted); list-style: none; }\n        .features-list li { margin-bottom: 0.5rem; padding-left: 1.2rem; position: relative; }\n        .features-list li::before { content: \"\u2713\"; position: absolute; left: 0; color: #10b981; font-weight: bold; }\n\n        /* Modal */\n        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: none; justify-content: center; align-items: center; z-index: 1000; }\n        .modal { background: white; padding: 2rem; border-radius: 16px; width: 100%; max-width: 450px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }\n        .modal h3 { margin-bottom: 1rem; font-size: 1.5rem; }\n        .modal p { color: var(--text-muted); margin-bottom: 1.5rem; font-size: 0.95rem; }\n        .modal-buttons { display: flex; gap: 1rem; }\n        .modal-buttons button { flex: 1; padding: 0.75rem; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; }\n        .btn-cancel { background: #e2e8f0; color: var(--text-main); }\n        .btn-confirm { background: var(--primary); color: white; }\n\n        footer { text-align: center; margin-top: 3rem; color: var(--text-muted); font-size: 0.85rem; padding-bottom: 2rem; }\n    </style>\n</head>\n<body>\n\n    <header>\n        <button class=\"lang-switch\" onclick=\"toggleLanguage()\">EN / \u4e2d\u6587</button>\n        <h1 id=\"header-title\">\ud83c\udf0d GlobalEase \u6d77\u5916\u751f\u6d3b\u901a</h1>\n        <p id=\"header-desc\">\u4e3a\u6d77\u5916\u751f\u6d3b\u3001\u8de8\u56fd\u5c45\u6c11\u6253\u9020\u7684\u667a\u80fd\u751f\u6d3b\u3001\u6587\u4e66\u7ffb\u8bd1\u3001\u9632\u9a97\u6bd4\u4ef7\u5168\u80fd\u52a9\u624b</p>\n    </header>\n\n    <div class=\"container\">\n        <!-- Dashboard / Membership Status Bar -->\n        <div class=\"dashboard-card\">\n            <div class=\"user-status\">\n                <h3><span id=\"user-greeting\">\u6b22\u8fce\u60a8\uff0c\u8bbf\u5ba2 (Visitor)</span> <span id=\"user-badge\" class=\"badge\">7\u5929\u514d\u8d39\u8bd5\u7528\u4e2d</span></h3>\n                <p id=\"user-status-text\">\u8bd5\u7528\u671f\u5269\u4f59: <strong id=\"trial-days\">7</strong> \u5929 | \u8d26\u6237\u4f59\u989d: <strong id=\"user-balance\">$0.00</strong></p>\n            </div>\n            <button class=\"pricing-btn\" onclick=\"window.location.href='/pricing'\">\ud83d\udc8e \u89e3\u9501\u65e0\u9650\u7545\u7528 / Upgrade</button>\n        </div>\n        <div class=\"dashboard-card\" style=\"background:#fffbeb;border:1px solid #f5d98b;font-size:0.9rem;line-height:1.6;\">\n            <strong>\u5982\u4f55\u83b7\u5f977\u5929\u514d\u8d39\u8bd5\u7528\uff1a</strong>\u7528 <a href=\"/login\" style=\"color:#1a4fa0;\">Email\u9a8c\u8bc1\u7801\u767b\u5f55</a> SY Horizon \u8d26\u53f7\uff08\u4e0d\u9700\u8981\u5bc6\u7801\uff09\uff0c\u9996\u6b21\u767b\u5f55\u540e\u7cfb\u7edf\u4f1a\u81ea\u52a8\u5f00\u59cb\u8ba1\u7b97\u60a8\u76847\u5929\u8bd5\u7528\u671f\uff0c\u671f\u95f4\u53ef\u65e0\u9650\u6b21\u4f7f\u7528\u672c\u5de5\u5177\u3002\u8bd5\u7528\u5230\u671f\u540e\uff0c\u53ef\u524d\u5f80 <a href=\"/pricing\" style=\"color:#1a4fa0;\">\u4ed8\u8d39\u65b9\u6848\u9875\u9762</a> \u9009\u8d2d\u5355\u6b21\u3001\u5305\u6708\u6216\u7ec8\u8eab\u65b9\u6848\u7ee7\u7eed\u4f7f\u7528\u3002\n        </div>\n\n        <div class=\"main-grid\">\n            <!-- Tools Area -->\n            <div class=\"tools-card\">\n                <div class=\"tabs\">\n                    <button class=\"tab-btn active\" onclick=\"switchTab(0)\" id=\"tab-1\">\ud83d\udcc4 \u5b98\u65b9\u6587\u4e66\u4e0e\u79fb\u6c11\u4fe1\u4ef6\u751f\u6210</button>\n                    <button class=\"tab-btn\" onclick=\"switchTab(1)\" id=\"tab-2\">\ud83d\udd0d \u5f53\u5730\u9632\u9a97\u4e0e\u98ce\u9669\u5feb\u67e5</button>\n                    <button class=\"tab-btn\" onclick=\"switchTab(2)\" id=\"tab-3\">\ud83d\uded2 \u6d77\u5916\u8d85\u5e02\u6bd4\u4ef7\u4e0e\u907f\u5751</button>\n                    <button class=\"tab-btn\" onclick=\"switchTab(3)\" id=\"tab-4\">\ud83d\udca1 \u672c\u5730\u751f\u6d3b\u6025\u6551\u95ee\u7b54</button>\n                </div>\n\n                <!-- Tool 1: Document / Immigration Letter -->\n                <div class=\"tool-panel active\" id=\"panel-0\">\n                    <h2 id=\"t1-title\">\u5b98\u65b9\u4fe1\u4ef6\u4e0e\u6587\u4e66\u667a\u80fd\u8d77\u8349</h2>\n                    <p class=\"desc\" id=\"t1-desc\">\u8f93\u5165\u60a8\u7684\u9700\u6c42\uff08\u5982\u623f\u4e1c\u50ac\u7f34\u3001\u79fb\u6c11\u5c40\u4fe1\u4ef6\u56de\u590d\u3001\u5b66\u6821\u8bf7\u5047\u3001\u94f6\u884c\u4ea4\u6d89\uff09\uff0c\u4e00\u952e\u751f\u6210\u4e13\u4e1a\u3001\u7b26\u5408\u5f53\u5730\u8bed\u6cd5\u7684\u6807\u51c6\u4fe1\u4ef6\u3002</p>\n                    <div class=\"form-group\">\n                        <label id=\"t1-l1\">\u4fe1\u4ef6\u7c7b\u578b / Document Type</label>\n                        <select id=\"doc-type\">\n                            <option value=\"landlord\">\u623f\u4e1c\u79df\u623f\u4ea4\u6d89/\u9000\u79df\u4fe1 (Landlord / Tenant Dispute)</option>\n                            <option value=\"uscis\">\u79fb\u6c11\u5c40/\u653f\u5e9c\u90e8\u95e8\u4fe1\u4ef6\u56de\u590d (Government / Visa Inquiry)</option>\n                            <option value=\"bank\">\u94f6\u884c\u8d26\u5355\u5f02\u8bae/\u8d39\u7528\u7533\u8bc9 (Bank Fee Dispute)</option>\n                            <option value=\"employer\">\u516c\u53f8\u8bf7\u5047/\u79bb\u804c\u4fe1 (Employer Notice)</option>\n                        </select>\n                    </div>\n                    <div class=\"form-group\">\n                        <label id=\"t1-l2\">\u5177\u4f53\u8bc9\u6c42\u4e0e\u8be6\u60c5\u63cf\u8ff0 / Details</label>\n                        <textarea id=\"doc-details\" rows=\"4\" placeholder=\"\u4f8b\u5982\uff1a\u6211\u7684\u79df\u7ea6\u5230\u671f\u51c6\u5907\u642c\u8d70\uff0c\u623f\u4e1c\u6263\u4e86\u6211\u5168\u989d\u62bc\u91d1\uff0c\u8bf7\u5e2e\u6211\u5199\u4e00\u5c01\u6b63\u5f0f\u50ac\u6536\u62bc\u91d1\u7684\u4fe1...\"></textarea>\n                    </div>\n                    <button class=\"action-btn\" onclick=\"runTool(1)\" id=\"t1-btn\">\u7acb\u5373\u751f\u6210\u4e13\u4e1a\u4fe1\u4ef6 ($0.9 \u6216 \u6263\u96641\u6b21)</button>\n                    <div class=\"result-box\" id=\"result-0\">\n                        <h4 id=\"res1-title\">\u751f\u6210\u7ed3\u679c\uff1a</h4>\n                        <div id=\"result-content-0\" style=\"white-space: pre-wrap; font-size: 0.95rem;\"></div>\n                    </div>\n                </div>\n\n                <!-- Tool 2: Scam & Risk Check -->\n                <div class=\"tool-panel\" id=\"panel-1\">\n                    <h2 id=\"t2-title\">\u6d77\u5916\u8bc8\u9a97\u3001\u865a\u5047\u4e2d\u4ecb\u4e0e\u94fe\u63a5\u5feb\u67e5</h2>\n                    <p class=\"desc\" id=\"t2-desc\">\u8f93\u5165\u53ef\u7591\u7684\u7f51\u5740\u3001\u7535\u8bdd\u53f7\u7801\u3001\u793e\u4ea4\u8d26\u53f7\u6216\u516c\u53f8\u540d\u79f0\uff0c\u667a\u80fd\u8bc6\u522b\u5e38\u89c1\u6d77\u5916\u6740\u732a\u76d8\u3001\u865a\u5047\u6362\u6c47\u3001\u9ed1\u5fc3\u79fb\u6c11\u4e2d\u4ecb\u3002</p>\n                    <div class=\"form-group\">\n                        <label id=\"t2-l1\">\u67e5\u8be2\u5bf9\u8c61 (\u7f51\u5740URL / \u7535\u8bdd / \u673a\u6784\u540d\u79f0)</label>\n                        <input type=\"text\" id=\"scam-target\" placeholder=\"\u4f8b\u5982\uff1afake-immigration-service.com \u6216 \u53ef\u7591\u7535\u8bdd\u53f7\">\n                    </div>\n                    <button class=\"action-btn\" onclick=\"runTool(2)\" id=\"t2-btn\">\u5f00\u59cb\u5b89\u5168\u8bc4\u4f30 ($0.9 \u6216 \u6263\u96641\u6b21)</button>\n                    <div class=\"result-box\" id=\"result-1\">\n                        <h4 id=\"res2-title\">\u5b89\u5168\u8bc4\u4f30\u62a5\u544a\uff1a</h4>\n                        <div id=\"result-content-1\" style=\"white-space: pre-wrap; font-size: 0.95rem;\"></div>\n                    </div>\n                </div>\n\n                <!-- Tool 3: Grocery & Price Comparison -->\n                <div class=\"tool-panel\" id=\"panel-2\">\n                    <h2 id=\"t3-title\">\u5f53\u5730\u8d85\u5e02\u6bd4\u4ef7\u4e0e\u6027\u4ef7\u6bd4\u6307\u5357</h2>\n                    <p class=\"desc\" id=\"t3-desc\">\u8f93\u5165\u60a8\u60f3\u8d2d\u4e70\u7684\u5546\u54c1\u6216\u65e5\u5e38\u5f00\u9500\u9879\u76ee\uff0c\u5bf9\u6bd4\u5f53\u5730\u5404\u5927\u4e3b\u6d41\u8d85\u5e02\uff08Costco, Walmart, Whole Foods\u7b49\uff09\u7684\u5386\u53f2\u5747\u4ef7\u4e0e\u7701\u94b1\u653b\u7565\u3002</p>\n                    <div class=\"form-group\">\n                        <label id=\"t3-l1\">\u5546\u54c1\u540d\u79f0 / Item Name</label>\n                        <input type=\"text\" id=\"grocery-item\" placeholder=\"\u4f8b\u5982\uff1a\u6709\u673a\u725b\u5976 / \u7ef4\u751f\u7d20 / \u6253\u5370\u673a\u7eb8\">\n                    </div>\n                    <button class=\"action-btn\" onclick=\"runTool(3)\" id=\"t3-btn\">\u83b7\u53d6\u6bd4\u4ef7\u653b\u7565 ($0.9 \u6216 \u6263\u96641\u6b21)</button>\n                    <div class=\"result-box\" id=\"result-2\">\n                        <h4 id=\"res3-title\">\u6bd4\u4ef7\u7ed3\u679c\uff1a</h4>\n                        <div id=\"result-content-2\" style=\"white-space: pre-wrap; font-size: 0.95rem;\"></div>\n                    </div>\n                </div>\n\n                <!-- Tool 4: Emergency Q&A -->\n                <div class=\"tool-panel\" id=\"panel-3\">\n                    <h2 id=\"t4-title\">\u6d77\u5916\u672c\u5730\u751f\u6d3b\u6025\u6551\u4e0e\u529e\u4e8b\u6307\u5357</h2>\n                    <p class=\"desc\" id=\"t4-desc\">\u89e3\u51b3\u5404\u7c7b\u7a81\u53d1\u72b6\u51b5\uff1a\u8f66\u7978\u4fdd\u9669\u600e\u4e48\u7406\u8d54\u3001\u533b\u7597\u6025\u6551\u600e\u4e48\u6c9f\u901a\u3001\u5783\u573e\u5206\u7c7b\u7f5a\u6b3e\u600e\u4e48\u5904\u7406\u3002</p>\n                    <div class=\"form-group\">\n                        <label id=\"t4-l1\">\u60a8\u9047\u5230\u7684\u95ee\u9898 / Your Situation</label>\n                        <textarea id=\"qa-details\" rows=\"4\" placeholder=\"\u4f8b\u5982\uff1a\u5728\u9ad8\u901f\u4e0a\u53d1\u751f\u4e86\u8f7b\u5fae\u5250\u8e6d\uff0c\u5bf9\u65b9\u6ca1\u6709\u4e70\u4fdd\u9669\uff0c\u6211\u8be5\u600e\u4e48\u62cd\u7167\u7559\u8bc1\u548c\u62a5\u8b66\uff1f\"></textarea>\n                    </div>\n                    <button class=\"action-btn\" onclick=\"runTool(4)\" id=\"t4-btn\">\u83b7\u53d6\u5e94\u6025\u6307\u5357 ($0.9 \u6216 \u6263\u96641\u6b21)</button>\n                    <div class=\"result-box\" id=\"result-3\">\n                        <h4 id=\"res4-title\">\u5e94\u6025\u5904\u7406\u65b9\u6848\uff1a</h4>\n                        <div id=\"result-content-3\" style=\"white-space: pre-wrap; font-size: 0.95rem;\"></div>\n                    </div>\n                </div>\n\n            </div>\n\n            <!-- Sidebar Pricing Options -->\n            <div class=\"sidebar\">\n                <div class=\"pricing-card\">\n                    <h3 id=\"p1-name\">\u5355\u6b21\u6309\u9700 / Pay-Per-Use</h3>\n                    <div class=\"price\">$0.90 <span>/ \u6b21</span></div>\n                    <ul class=\"features-list\">\n                        <li id=\"p1-f1\">\u9002\u5408\u5076\u5c14\u67e5\u8be2\u6025\u7528</li>\n                        <li id=\"p1-f2\">\u4e0d\u9650\u529f\u80fd\u4efb\u9009</li>\n                        <li id=\"p1-f3\">\u6c38\u4e0d\u8fc7\u671f</li>\n                    </ul>\n                    <button class=\"action-btn\" onclick=\"buyPackage('single', 0.9)\">\u524d\u5f80\u8cfc\u8cb7 $0.9/\u6b21</button>\n                </div>\n\n                <div class=\"pricing-card popular\">\n                    <h3 id=\"p2-name\">\u5305\u6708\u7545\u7528 / Monthly Pass</h3>\n                    <div class=\"price\">$5.70 <span>/ \u6708</span></div>\n                    <ul class=\"features-list\">\n                        <li id=\"p2-f1\">\u65e0\u9650\u6b21\u4f7f\u7528\u6240\u6709\u6838\u5fc3\u5de5\u5177</li>\n                        <li id=\"p2-f2\">\u4f18\u5148\u54cd\u5e94\u901a\u9053</li>\n                        <li id=\"p2-f3\">\u968f\u65f6\u53ef\u53d6\u6d88\u8ba2\u9605</li>\n                    </ul>\n                    <button class=\"action-btn\" onclick=\"buyPackage('monthly', 5.7)\">\u7acb\u5373\u8a02\u95b1 $5.7/\u6708</button>\n                </div>\n\n                <div class=\"pricing-card\">\n                    <h3 id=\"p3-name\">\u7ec8\u8eab\u4e70\u65ad / Lifetime Access</h3>\n                    <div class=\"price\">$38.00 <span>/ \u7ec8\u8eab</span></div>\n                    <ul class=\"features-list\">\n                        <li id=\"p3-f1\">\u4e00\u6b21\u4ed8\u8d39\uff0c\u6c38\u4e45\u7545\u7528</li>\n                        <li id=\"p3-f2\">\u5305\u542b\u672a\u6765\u6240\u6709\u5347\u7ea7\u529f\u80fd</li>\n                        <li id=\"p3-f3\">\u6700\u9ad8\u6027\u4ef7\u6bd4\u4e4b\u9009</li>\n                    </ul>\n                    <button class=\"action-btn\" onclick=\"buyPackage('lifetime', 38.0)\">\u6c38\u4e45\u8cb7\u65b7 $38</button>\n                </div>\n            </div>\n        </div>\n    </div>\n\n    <!-- Payment Modal -->\n    <div class=\"modal-overlay\" id=\"payment-modal\">\n        <div class=\"modal\">\n            <h3 id=\"modal-title\">\u786e\u8ba4\u5347\u7ea7 / Confirm Upgrade</h3>\n            <p id=\"modal-desc\">\u60a8\u6b63\u5728\u9009\u62e9\u5347\u7ea7\u65b9\u6848\uff0c\u7cfb\u7edf\u652f\u6301Stripe / PayPal / \u5fae\u4fe1\u652f\u4ed8\u56fd\u9645\u7248\u3002\u652f\u4ed8\u6210\u529f\u540e\u7acb\u5373\u751f\u6548\u3002</p>\n            <div class=\"modal-buttons\">\n                <button class=\"btn-cancel\" onclick=\"closePricingModal()\" id=\"modal-cancel\">\u53d6\u6d88</button>\n                <button class=\"btn-confirm\" onclick=\"confirmPayment()\" id=\"modal-pay\">\u786e\u8ba4\u652f\u4ed8</button>\n            </div>\n        </div>\n    </div>\n\n    <footer>\n        <p>GlobalEase Assistant \u00a9 2026 | Designed for Overseas Chinese & Global Communities</p>\n    </footer>\n\n    <script>\n        let currentLang = 'zh';\n        let trialDaysLeft = 7;\n        let userBalance = 0.00;\n        let isVIP = false;\n        let selectedPlan = '';\n\n        function toggleLanguage() {\n            currentLang = currentLang === 'zh' ? 'en' : 'zh';\n            if (currentLang === 'en') {\n                document.getElementById('header-title').innerText = '\ud83c\udf0d GlobalEase Assistant';\n                document.getElementById('header-desc').innerText = 'The Ultimate AI Assistant for Overseas Chinese & Global Residents: Document Drafting, Scam Check & Price Comparison';\n                document.getElementById('tab-1').innerText = '\ud83d\udcc4 Official Document & Letter';\n                document.getElementById('tab-2').innerText = '\ud83d\udd0d Scam & Risk Check';\n                document.getElementById('tab-3').innerText = '\ud83d\uded2 Grocery & Price Guide';\n                document.getElementById('tab-4').innerText = '\ud83d\udca1 Local Emergency Q&A';\n                document.getElementById('p1-name').innerText = 'Pay-Per-Use';\n                document.getElementById('p2-name').innerText = 'Monthly Pass';\n                document.getElementById('p3-name').innerText = 'Lifetime Access';\n            } else {\n                document.getElementById('header-title').innerText = '\ud83c\udf0d GlobalEase \u6d77\u5916\u751f\u6d3b\u901a';\n                document.getElementById('header-desc').innerText = '\u4e3a\u6d77\u5916\u751f\u6d3b\u3001\u8de8\u56fd\u5c45\u6c11\u6253\u9020\u7684\u667a\u80fd\u751f\u6d3b\u3001\u6587\u4e66\u7ffb\u8bd1\u3001\u9632\u9a97\u6bd4\u4ef7\u5168\u80fd\u52a9\u624b';\n                document.getElementById('tab-1').innerText = '\ud83d\udcc4 \u5b98\u65b9\u6587\u4e66\u4e0e\u79fb\u6c11\u4fe1\u4ef6\u751f\u6210';\n                document.getElementById('tab-2').innerText = '\ud83d\udd0d \u5f53\u5730\u9632\u9a97\u4e0e\u98ce\u9669\u5feb\u67e5';\n                document.getElementById('tab-3').innerText = '\ud83d\uded2 \u6d77\u5916\u8d85\u5e02\u6bd4\u4ef7\u4e0e\u907f\u5751';\n                document.getElementById('tab-4').innerText = '\ud83d\udca1 \u672c\u5730\u751f\u6d3b\u6025\u6551\u95ee\u7b54';\n                document.getElementById('p1-name').innerText = '\u5355\u6b21\u6309\u9700 / Pay-Per-Use';\n                document.getElementById('p2-name').innerText = '\u5305\u6708\u7545\u7528 / Monthly Pass';\n                document.getElementById('p3-name').innerText = '\u7ec8\u8eab\u4e70\u65ad / Lifetime Access';\n            }\n        }\n\n        function switchTab(index) {\n            document.querySelectorAll('.tab-btn').forEach((btn, idx) => {\n                btn.classList.toggle('active', idx === index);\n            });\n            document.querySelectorAll('.tool-panel').forEach((panel, idx) => {\n                panel.classList.toggle('active', idx === index);\n            });\n        }\n\n        function openPricingModal() {\n            document.getElementById('payment-modal').style.display = 'flex';\n        }\n\n        function closePricingModal() {\n            document.getElementById('payment-modal').style.display = 'none';\n        }\n\n        function buyPackage(plan, price) {\n            window.location.href = '/pricing';\n        }\n\n        async function runTool(toolId) {\n            const resultBox = document.getElementById(`result-${toolId-1}`);\n            const resultContent = document.getElementById(`result-content-${toolId-1}`);\n\n            resultBox.style.display = 'block';\n            resultContent.innerHTML = '<span style=\"color: #64748b;\">\u6b63\u5728\u667a\u80fd\u8fde\u63a5\u6d77\u5916\u6cd5\u5f8b\u4e0e\u751f\u6d3b\u6570\u636e\u5e93\uff0c\u751f\u6210\u4e13\u4e1a\u5185\u5bb9...</span>';\n\n            const toolMap = {\n                1: { tool: 'document', input: () => ({ docType: document.getElementById('doc-type').value, details: document.getElementById('doc-details').value }) },\n                2: { tool: 'scam', input: () => ({ target: document.getElementById('scam-target').value }) },\n                3: { tool: 'grocery', input: () => ({ item: document.getElementById('grocery-item').value }) },\n                4: { tool: 'emergency', input: () => ({ situation: document.getElementById('qa-details').value }) },\n            };\n            const cfg = toolMap[toolId];\n\n            try {\n                const resp = await fetch('/api/globalease/generate', {\n                    method: 'POST',\n                    headers: { 'Content-Type': 'application/json' },\n                    body: JSON.stringify({ tool: cfg.tool, input: cfg.input() }),\n                });\n                const data = await resp.json();\n                if (!resp.ok) {\n                    resultContent.innerHTML = `<span style=\"color:#dc2626;\">${data.error || '\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002'}</span>`;\n                    return;\n                }\n                resultContent.innerText = data.result;\n            } catch (e) {\n                resultContent.innerHTML = '<span style=\"color:#dc2626;\">\u7f51\u7edc\u9519\u8bef\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002</span>';\n            }\n        }\n    </script>\n</body>\n</html>\n",
};

const TRIAL_DAYS = 7;

// 相容 D1 的 "YYYY-MM-DD HH:MM:SS"(datetime('now')/CURRENT_TIMESTAMP,UTC)與 ISO 8601 兩種時間格式,避免日期解析失敗
function parseDbDate(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) {
    // 沒有時區標記的日期字串視為 UTC,補上 Z 後解析
    s = s.replace(" ", "T") + "Z";
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function checkTrialAccess(request, env) {
  const token = getCookie(request, USER_SESSION_COOKIE);
  if (!token) return { ok: false, reason: "not_logged_in" };

  const session = await env.DB.prepare(
    "SELECT * FROM user_sessions WHERE token = ? AND expires_at > datetime('now')"
  ).bind(token).first();
  if (!session) return { ok: false, reason: "not_logged_in" };

  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(session.user_id).first();
  if (!user) return { ok: false, reason: "not_logged_in" };

  // ===== V73: 新用戶 7 天免費試用,以 created_at + 7 天判定到期日 =====
  // 試用起點優先取 created_at(註冊當下);若舊版機制已寫過 trial_started_at(首次使用才開始計時),
  // 則取兩者較晚者,避免既有用戶的試用權益被回溯性縮短。
  const createdRaw = (user.created_at || "").toString();
  const trialStartedRaw = (user.trial_started_at || "").toString();
  let startRaw = createdRaw;
  if (trialStartedRaw && (!startRaw || trialStartedRaw > startRaw)) {
    startRaw = trialStartedRaw;
  }
  if (!startRaw) {
    // 兜底:users 表沒有 created_at 也沒有 trial_started_at(資料異常),視為現在開始試用
    await env.DB.prepare("UPDATE users SET trial_started_at = datetime('now') WHERE id = ?").bind(user.id).run();
    return { ok: true, daysLeft: TRIAL_DAYS };
  }

  const startedAt = parseDbDate(startRaw);
  if (!startedAt) {
    // 日期格式異常(資料損壞),保守視為試用已結束,不開放免費使用
    return { ok: false, reason: "trial_expired" };
  }
  const daysPassed = (Date.now() - startedAt.getTime()) / 86400000;
  if (daysPassed < TRIAL_DAYS) {
    return { ok: true, daysLeft: Math.max(1, Math.ceil(TRIAL_DAYS - daysPassed)) };
  }
  return { ok: false, reason: "trial_expired" };
}

async function renderPremiumTool(request, env, lang, slug) {
  const paidOk = await hasValidAccess(request, env, slug);
  let daysLeft = null;

  if (!paidOk) {
    const trial = await checkTrialAccess(request, env);
    if (!trial.ok) {
      if (trial.reason === "not_logged_in") {
        return Response.redirect(SITE_BASE_URL + langPrefix(lang) + "/login", 302);
      }
      // 試用期已過,導向付費頁
      return Response.redirect(SITE_BASE_URL + langPrefix(lang) + "/pricing", 302);
    }
    daysLeft = trial.daysLeft;
  }

  let html = PREMIUM_TOOLS[slug];
  if (!html) {
    return new Response("此工具內容尚未上架,請聯絡站方。", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (daysLeft !== null) {
    html = html.replace(">7</strong>", `>${daysLeft}</strong>`);
  } else {
    html = html.replace("試用期剩餘: <strong id=\"trial-days\">7</strong> 天 | ", "");
  }
  // V75: 英文版把付費工具內建狀態列的標籤換成英文(僅影響顯示文字,不改變任何邏輯)
  // 注意:該工具 HTML 內建文字是簡體中文,所以這裡用簡體字串做替換
  if (lang === "en") {
    html = html.replace("试用期剩余: ", "Trial left: ");
    html = html.replace(" 天 |", " day(s) |");
    html = html.replace("账户余额: ", "Balance: ");
    html = html.replace("7天免费试用中", "7-day trial active");
  }
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function renderToolsPage(request, env, lang) {
  const DOWNLOAD_GROUPS = [
    {
      titleKey: "grp_life",
      tools: [
        {
          nameKey: "tool_unit_converter_name",
          descKey: "tool_unit_converter_desc",
          repoUrl: "/tools/life/unit-converter",
        },
        {
          nameKey: "tool_media_downloader_name",
          descKey: "tool_media_downloader_desc",
          repoUrl: "/tools/life/media-downloader",
        },
      ],
    },
    {
      titleKey: "grp_office",
      tools: [
        {
          nameKey: "tool_bookmark_cleaner_name",
          descKey: "tool_bookmark_cleaner_desc",
          repoUrl: "/tools/office/bookmark-cleaner",
        },
        {
          nameKey: "tool_url_shortener_name",
          descKey: "tool_url_shortener_desc",
          repoUrl: "/tools/office/url-shortener",
        },
      ],
    },
    {
      titleKey: "grp_writing",
      tools: [
        {
          nameKey: "tool_word_counter_name",
          descKey: "tool_word_counter_desc",
          repoUrl: "/tools/writing/word-counter",
        },
        {
          nameKey: "tool_tc_sc_converter_name",
          descKey: "tool_tc_sc_converter_desc",
          repoUrl: "/tools/writing/tc-sc-converter",
        },
        {
          nameKey: "tool_text_to_speech_name",
          descKey: "tool_text_to_speech_desc",
          repoUrl: "/tools/writing/text-to-speech",
        },
      ],
    },
  ];

  const groupTabsHtml = DOWNLOAD_GROUPS
    .map((group, i) => `<button class="tool-tab-btn${i === 0 ? " active" : ""}" onclick="switchToolGroup(${i})">${escapeHtml(t(lang, group.titleKey))}</button>`)
    .join("");

  // ===== V73: 工具頁面試用提示與用戶狀態列 =====
  const trial = await checkTrialAccess(request, env);
  const paid = await hasValidAccess(request, env, GLOBALEASE_SLUG);
  const toolsPrefix = langPrefix(lang);
  // V75: 試用提示框文字走 i18n 字典(/en/ 時自動切換為英文)
  let trialBannerHtml = "";
  if (paid) {
    trialBannerHtml = `<div class="trial-banner paid">${t(lang, "trial_banner_paid")}</div>`;
  } else if (trial.ok) {
    trialBannerHtml = `<div class="trial-banner active">${String(t(lang, "trial_banner_active")).replace("{days}", trial.daysLeft)}</div>`;
  } else if (trial.reason === "not_logged_in") {
    trialBannerHtml = `<div class="trial-banner">${String(t(lang, "trial_banner_login")).replace("{login_link}", `<a href="${toolsPrefix}/login">${escapeHtml(t(lang, "login_label"))}</a>`)}</div>`;
  } else {
    trialBannerHtml = `<div class="trial-banner expired">${String(t(lang, "trial_banner_expired")).replace("{pricing_link}", `<a href="${toolsPrefix}/pricing">${escapeHtml(t(lang, "pricing_link_label"))}</a>`)}</div>`;
  }

  // V75: 付費卡片標題/描述/按鈕走 i18n 字典(/en/ 時自動切換為英文)
  const premiumToolHtml = `
    <section class="premium-tool-block">
      <h2>${escapeHtml(t(lang, "premium_tools"))}</h2>
      <div class="tools-grid">
        <div class="tool-card premium-card">
          <h3>${escapeHtml(t(lang, "premium_card_name"))}</h3>
          <p class="tool-desc">${escapeHtml(t(lang, "premium_card_desc"))}</p>
          <a class="tool-link" href="/pricing">${escapeHtml(t(lang, "premium_card_cta"))}</a>
        </div>
      </div>
    </section>
  `;

  const downloadGroupsHtml = DOWNLOAD_GROUPS.map((group, i) => `
    <section class="tool-group${i === 0 ? " active" : ""}" id="tool-group-${i}">
      <div class="tools-grid">
        ${group.tools.map((tool) => `
          <div class="tool-card">
            <h3>${escapeHtml(t(lang, tool.nameKey))}</h3>
            <p class="tool-desc">${escapeHtml(t(lang, tool.descKey))}</p>
            <a class="tool-link" href="${escapeHtml(tool.repoUrl)}">${escapeHtml(t(lang, "open_tool"))}</a>
          </div>
        `).join("")}
      </div>
    </section>
  `).join("");

  const TOOLS = [
    {
      name: "Manuskript",
      descKey: "rec1_desc",
      reasonKey: "rec1_reason",
      url: "https://www.theologeek.ch/manuskript/",
    },
    {
      name: "Zotero",
      descKey: "rec2_desc",
      reasonKey: "rec2_reason",
      url: "https://www.zotero.org/",
    },
    {
      name: "Obsidian",
      descKey: "rec3_desc",
      reasonKey: "rec3_reason",
      url: "https://obsidian.md/",
    },
    {
      name: "ProcessOn",
      descKey: "rec4_desc",
      reasonKey: "rec4_reason",
      url: "https://www.processon.com/",
    },
  ];

  // V75: 推薦工具卡內容走 i18n 字典(/en/ 時自動切換為英文)
  const cardsHtml = TOOLS.map((tool) => `
    <div class="tool-card">
      <h3>${escapeHtml(tool.name)}</h3>
      <p class="tool-desc">${escapeHtml(t(lang, tool.descKey))}</p>
      <p class="tool-reason">${escapeHtml(t(lang, tool.reasonKey))}</p>
      <a class="tool-link" href="${escapeHtml(tool.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t(lang, "visit_site"))}</a>
    </div>
  `).join("");

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t(lang, "nav_tools"))} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: t(lang, "nav_tools") + " - SY Horizon", description: t(lang, "tools_meta_desc"), path: "/tools", lang })}
<style>
  ${BASE_STYLE}
  .tool-tabs {
    display: flex;
    gap: 0.8rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
    border-bottom: 1px solid #ddd;
    padding-bottom: 0.8rem;
  }
  .tool-tab-btn {
    padding: 0.5rem 1.2rem;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 20px;
    color: #333;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }
  .tool-tab-btn:hover { background: #eef3fb; }
  .tool-tab-btn.active { background: #1a4fa0; color: #fff; border-color: #1a4fa0; }
  .tool-group { display: none; margin-bottom: 2.5rem; }
  .tool-group.active { display: block; }
  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1.2rem;
  }
  .tool-card {
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 1.2rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  .tool-card h3 { margin: 0 0 0.6rem 0; color: #1a1a1a; }
  .tool-desc { color: #333; line-height: 1.6; margin: 0 0 0.6rem 0; }
  .tool-reason { color: #777; font-size: 0.85rem; line-height: 1.5; margin: 0 0 0.8rem 0; }
  .tool-link { color: #1a4fa0; text-decoration: none; font-weight: 600; }
  .tool-link:hover { text-decoration: underline; }
  .tools-section-title { margin-top: 3rem; }
  .premium-tool-block { margin-bottom: 2.5rem; }
  .premium-tool-block h2 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
  .premium-card { border: 2px solid #d4a017; background: #fffbeb; }
  .trial-banner {
    padding: 0.9rem 1.2rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    font-size: 0.95rem;
    line-height: 1.6;
    border: 1px solid #d4a017;
    background: #fffbeb;
    color: #6b5200;
  }
  .trial-banner a { color: #1a4fa0; font-weight: 600; }
  .trial-banner.active { background: #e8f5e9; border-color: #4caf50; color: #1b5e20; }
  .trial-banner.paid { background: #e3f2fd; border-color: #1a4fa0; color: #0d2f66; }
  .trial-banner.expired { background: #fdecea; border-color: #e57373; color: #7f1d1d; }
</style>
</head>
<body>
  ${buildNav(lang, "/tools")}
  <div class="content-wrap">
    <h1>${escapeHtml(t(lang, "nav_tools"))}</h1>
    ${trialBannerHtml}
    ${premiumToolHtml}
    <h2 class="tools-section-title">${escapeHtml(t(lang, "free_tools_title"))}</h2>
    <div class="tool-tabs">${groupTabsHtml}</div>
    ${downloadGroupsHtml}
    <h2 class="tools-section-title">${escapeHtml(t(lang, "rec_tools_title"))}</h2>
    <div class="tools-grid">
      ${cardsHtml}
    </div>
  </div>
  <script>
    function switchToolGroup(i) {
      document.querySelectorAll('.tool-tab-btn').forEach((btn, idx) => btn.classList.toggle('active', idx === i));
      document.querySelectorAll('.tool-group').forEach((sec, idx) => sec.classList.toggle('active', idx === i));
    }
  </script>
  ${buildFooter(lang)}
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function youtubeEmbedUrl(url) {
  let videoId = "";
  const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
  const longMatch = url.match(/[?&]v=([^&]+)/);
  if (shortMatch) videoId = shortMatch[1];
  else if (longMatch) videoId = longMatch[1];
  return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
}

async function renderMediaPage(env, lang, url) {
  const { results: allResults } = await env.DB.prepare(
    "SELECT id, title, series_title, chapter_no, language, youtube_url, description, category FROM media ORDER BY id DESC"
  ).all();

  const activeCategory = url ? url.searchParams.get("category") : null;
  const results = activeCategory
    ? allResults.filter((m) => m.category === activeCategory)
    : allResults;

  // V75-FIX: 多媒體頁翻譯改為「快取優先 + 每頁AI預算上限 + 逐項try-catch + 並行3」,
  // 確保 /en/media 永遠快速返回數據,不會因大量未快取的AI翻譯呼叫把請求卡到超時(無限轉圈);
  // 超出預算或翻譯失敗的項目直接回退顯示原文,絕不讓單一項目拖垮整頁
  const MEDIA_AI_BUDGET_PER_PAGE = 8;
  let mediaAiBudget = MEDIA_AI_BUDGET_PER_PAGE;
  const translateMediaField = async (m, field, originalText) => {
    try {
      if (lang === "zh-Hant") return originalText;
      const cached = await env.DB.prepare(
        "SELECT translated_text FROM translations WHERE content_type = ? AND content_id = ? AND lang = ? AND field = ?"
      ).bind("media", m.id, lang, field).first();
      if (cached && cached.translated_text && String(cached.translated_text).trim()) return cached.translated_text;
      if (mediaAiBudget <= 0) return originalText;
      mediaAiBudget--;
      return await getOrTranslate(env, "media", m.id, lang, field, originalText);
    } catch (e) {
      return originalText;
    }
  };
  const mediaTitlesT = await mapWithConcurrency(results, 3, (m) =>
    translateMediaField(m, "title", m.title)
  );
  const mediaDescsT = await mapWithConcurrency(results, 3, (m) =>
    translateMediaField(m, "description", m.description || "")
  );

  const MEDIA_CATEGORIES = ["及時新聞", "文學作品", "奇聞異事", "生活小知識"];
  const prefix = langPrefix(lang);
  const catTabsHtml = [
    `<a href="${prefix}/media" class="${!activeCategory ? "lit-cat-active" : ""}">${escapeHtml(t(lang, "lit_all"))}</a>`,
    ...MEDIA_CATEGORIES.map((c) =>
      `<a href="${prefix}/media?category=${encodeURIComponent(c)}" class="${activeCategory === c ? "lit-cat-active" : ""}">${escapeHtml(catLabel(lang, c))}</a>`
    ),
  ].join("");

  let itemsHtml = results
    .map((m, idx) => `
      <div class="media-card">
        <h3>${escapeHtml(mediaTitlesT[idx] || m.title)}</h3>
        <div class="media-embed">
          <iframe src="${escapeHtml(youtubeEmbedUrl(m.youtube_url))}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>
        ${mediaDescsT[idx] ? `<p class="media-desc">${escapeHtml(mediaDescsT[idx])}</p>` : ""}
      </div>
    `)
    .join("");

  if (!itemsHtml) itemsHtml = `<p>${escapeHtml(t(lang, "news_no_data"))}</p>`;

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t(lang, "nav_media"))} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: t(lang, "nav_media") + " - SY Horizon", description: t(lang, "media_meta_desc"), path: "/media", lang })}
<style>
  ${BASE_STYLE}
  .media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; }
  .media-card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .media-card h3 { margin: 0 0 0.8rem 0; color: #1a1a1a; font-size: 1rem; }
  .media-desc { color: #444; font-size: 0.85rem; line-height: 1.6; margin: 0.8rem 0 0 0; }
  .media-embed { position: relative; width: 100%; padding-bottom: 56.25%; height: 0; }
  .media-embed iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: 4px; }
  .lit-cats { margin: 0.3rem 0 1.5rem 0; }
  .lit-cats a {
    color: #555; text-decoration: none; margin-right: 1.2rem; font-size: 0.9rem;
    padding-bottom: 2px; border-bottom: 2px solid transparent;
  }
  .lit-cats a:hover { color: #1a4fa0; }
  .lit-cats a.lit-cat-active { color: #1a4fa0; border-bottom-color: #1a4fa0; font-weight: 600; }
</style>
</head>
<body>
  ${buildNav(lang, "/media")}
  <div class="content-wrap">
    <h1>${escapeHtml(t(lang, "nav_media"))}</h1>
    <p class="lit-cats">${catTabsHtml}</p>
    <div class="media-grid">
      ${itemsHtml}
    </div>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// V78-LINKFIX: 「前往原文」連結防呆 — 只允許 http(s) 外部網址;相對路徑/空值/危險協議
// (例如 link 誤填成站內路徑 /ai-chat-xxx)一律改為 Bing 搜尋標題,避免跳到站內不存在的路徑
// V80-BINGFIX: 備援搜尋引擎由 Google 改為 Bing(中國大陸與全球皆可存取)
function safeOriginalLink(link, title) {
  const raw = String(link || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return "https:" + raw; // 協議相對網址
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/|$)/i.test(raw)) return "https://" + raw; // 裸域名補協議
  const q = encodeURIComponent(String(title || "").trim());
  return q ? "https://www.bing.com/search?q=" + q : "#";
}

async function renderNewsItem(url, env, lang, request) {
  const id = url.searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const row = await env.DB.prepare("SELECT * FROM articles WHERE id = ?").bind(id).first();
  if (!row) return new Response("Not Found", { status: 404 });

  const displayTitle = await getOrTranslate(env, "news", row.id, lang, "title", row.title);
  const expandedSummary = await getOrExpandSummary(env, row, request);
  const displaySummary = await getOrTranslate(env, "news", row.id, lang, "summary", expandedSummary || "");
  // 沒有人工編輯評論時,即時用AI生成一段並寫回資料庫快取(下次造訪直接讀快取,不重複呼叫AI)
  const rawComment = await getOrGenerateComment(env, row, request);
  const hasComment = rawComment && rawComment.trim();
  const displayComment = hasComment
    ? await getOrTranslate(env, "news", row.id, lang, "editor_comment", rawComment)
    : "";

  const prefix = langPrefix(lang);
  const commentHtml = hasComment
    ? `<div class="editor-comment"><h3>編輯評論 / Editor's Note</h3><p>${escapeHtml(displayComment)}</p></div>`
    : "";
  const articleUrl = SITE_BASE_URL + langPrefix(lang) + "/news/read?id=" + row.id;
  const jsonLd = buildArticleJsonLd({
    title: displayTitle,
    description: displaySummary,
    url: articleUrl,
    datePublished: row.published_at,
    image: row.image_url,
  });

  const page = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(displayTitle)} - ${escapeHtml(t(lang, "site_name"))}</title>
${buildHeadMeta({ title: displayTitle + " - SY Horizon", description: displaySummary, path: "/news/read?id=" + row.id, lang, type: "article", image: row.image_url })}
${jsonLd}
<style>
  ${BASE_STYLE}
  .lit-meta { color: #888; font-size: 0.85rem; }
  .lit-meta a { color: #1a4fa0; text-decoration: none; }
  .summary { line-height: 1.8; font-size: 1.02rem; }
  .editor-comment { background: #fff8ea; border-left: 4px solid #d4a017; padding: 1rem 1.2rem; margin: 1.5rem 0; border-radius: 4px; }
  .editor-comment h3 { margin: 0 0 0.5rem 0; color: #8a6300; font-size: 0.95rem; }
  .editor-comment-empty { background: #f2f2f2; border-left-color: #ccc; color: #888; }
  .original-link { display: inline-block; margin-top: 1rem; color: #1a4fa0; }
</style>
</head>
<body>
  ${buildNav(lang, "/news")}
  <div class="content-wrap">
    <p class="lit-meta"><a href="${prefix}/news">← ${escapeHtml(t(lang, "nav_news"))}</a></p>
    <h1>${escapeHtml(displayTitle)}</h1>
    ${englishFallbackNote(lang, displaySummary)}
    <p class="lit-meta">${escapeHtml(t(lang, "news_source"))}:${escapeHtml(row.source || "")} | ${escapeHtml(row.published_at || "")}</p>
    <p class="summary">${escapeHtml(displaySummary)}</p>
    ${commentHtml}
    <a class="original-link" href="${escapeHtml(safeOriginalLink(row.link, row.title))}" target="_blank" rel="noopener noreferrer">前往原文 / Original Source →</a>
  </div>
  ${buildFooter(lang)}
</body>
</html>`;

  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const SITE_BASE_URL = "https://sylogs.com";

async function renderSitemap(env) {
  const urls = [];
  const today = new Date().toISOString().slice(0, 10);

  // 靜態頁面
  const staticPaths = ["/", "/news", "/literature", "/media", "/tools", "/guide", "/beginners", "/tougao", "/about", "/author/shengyan", "/editorial-policy", "/privacy-policy", "/contact", "/free", "/pricing"];
  for (const p of staticPaths) {
    urls.push({ loc: SITE_BASE_URL + p, changefreq: "daily", priority: p === "/" ? "1.0" : "0.6" });
  }

  // 小工具頁面
  const toolSlugs = [
    "life/unit-converter", "life/media-downloader", "office/bookmark-cleaner", "office/url-shortener",
    "writing/word-counter", "writing/tc-sc-converter", "writing/text-to-speech",
  ];
  for (const slug of toolSlugs) {
    urls.push({ loc: `${SITE_BASE_URL}/tools/${slug}`, changefreq: "monthly", priority: "0.6" });
  }

  // 新聞文章(有 published_at 就當 lastmod)
  const { results: articleRows } = await env.DB.prepare(
    "SELECT id, published_at FROM articles ORDER BY id DESC"
  ).all();
  for (const row of articleRows) {
    urls.push({
      loc: `${SITE_BASE_URL}/news/read?id=${row.id}`,
      lastmod: (row.published_at || "").slice(0, 10) || undefined,
      changefreq: "monthly",
      priority: "0.5",
    });
  }

  // 文學作品(只列已到公開日期的章節)
  const { results: litRows } = await env.DB.prepare(
    "SELECT id, publish_date FROM literature ORDER BY id"
  ).all();
  for (const row of litRows) {
    if (row.publish_date && row.publish_date > today) continue;
    urls.push({ loc: `${SITE_BASE_URL}/literature/read?id=${row.id}`, changefreq: "monthly", priority: "0.7" });
  }

  // 避坑指南
  const { results: guideRows } = await env.DB.prepare("SELECT id FROM guides ORDER BY id").all();
  for (const row of guideRows) {
    urls.push({ loc: `${SITE_BASE_URL}/guide/read?id=${row.id}`, changefreq: "monthly", priority: "0.5" });
  }

  const xmlItems = urls
    .map((u) => {
      const lastmodTag = u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : "";
      return `<url><loc>${escapeXml(u.loc)}</loc>${lastmodTag}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${xmlItems}</urlset>`;

  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

function renderRobotsTxt() {
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_BASE_URL}/sitemap.xml\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function escapeXml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const TOOL_PAGES = {
  "life/media-downloader": `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>影片一鍵下載工具 - SY Horizon</title>
<style>
  body { font-family: -apple-system, "Microsoft JhengHei", sans-serif; max-width: 640px; margin: 40px auto; padding: 20px; color: #222; background: #f7f5f0; }
  h1 { font-size: 1.4rem; }
  .box { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem; margin-top: 1rem; }
  input[type=text] { width: 100%; padding: 0.7rem; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; box-sizing: border-box; margin-bottom: 1rem; }
  button { padding: 0.7rem 1.5rem; background: #1a4fa0; color: #fff; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; }
  button:hover { background: #123a78; }
  .result { margin-top: 1.5rem; white-space: pre-wrap; word-break: break-all; background: #f5f3ee; padding: 1rem; border-radius: 6px; font-size: 0.9rem; display: none; }
  .result a { color: #1a4fa0; }
  .note { font-size: 0.85rem; color: #888; margin-top: 1rem; }
</style>
</head>
<body>
  <h1>影片一鍵下載工具</h1>
  <p>貼上影片網址（支援 YouTube、TikTok、Instagram 等平台），一鍵取得無浮水印下載連結與文案。</p>
  <div class="box">
    <input type="text" id="video-url" placeholder="請貼上影片網址">
    <button onclick="doDownload()" id="dl-btn">立即取得下載連結</button>
    <div class="result" id="result"></div>
    <p class="note">下載連結由第三方服務提供，請自行確認來源影片版權歸屬，僅供個人合理使用。</p>
  </div>
  <script>
    async function doDownload() {
      const url = document.getElementById('video-url').value.trim();
      const resultBox = document.getElementById('result');
      if (!url) { alert('請先輸入影片網址'); return; }
      resultBox.style.display = 'block';
      resultBox.innerText = '正在解析，請稍候...';
      try {
        const resp = await fetch('/api/media-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          resultBox.innerText = data.error || '解析失敗，請確認網址是否正確。';
          return;
        }
        resultBox.innerText = JSON.stringify(data, null, 2);
      } catch (e) {
        resultBox.innerText = '網路錯誤，請稍後再試。';
      }
    }
  </script>
</body>
</html>`,
  "life/unit-converter": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>\u751f\u6d3b\u5e38\u7528\u55ae\u4f4d\u63db\u7b97\u5c0f\u5de5\u5177 - SY Horizon</title>\n    <style>\n        body {\n            font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n            max-width: 800px;\n            margin: 40px auto;\n            padding: 0 20px;\n            background-color: #f9f9f9;\n            color: #333;\n        }\n        h1 { font-size: 24px; color: #111; margin-bottom: 10px; }\n        .instructions {\n            background: #e1f5fe;\n            padding: 15px 20px;\n            border-radius: 6px;\n            margin-bottom: 20px;\n            font-size: 14px;\n            color: #01579b;\n            border: 1px solid #b3e5fc;\n        }\n        .instructions ol {\n            margin: 8px 0 0 20px;\n            padding: 0;\n            line-height: 1.6;\n        }\n        .card {\n            background: #fff;\n            padding: 20px;\n            border-radius: 6px;\n            border: 1px solid #e1e4e8;\n            margin-bottom: 20px;\n            box-shadow: 0 1px 3px rgba(0,0,0,0.05);\n        }\n        .tabs {\n            display: flex;\n            gap: 10px;\n            margin-bottom: 20px;\n            flex-wrap: wrap;\n        }\n        .tab-btn {\n            background-color: #f1f8ff;\n            color: #0366d6;\n            border: 1px solid #c8e1ff;\n            padding: 8px 16px;\n            border-radius: 6px;\n            font-weight: bold;\n            cursor: pointer;\n            font-size: 14px;\n        }\n        .tab-btn.active {\n            background-color: #0366d6;\n            color: white;\n            border-color: #0366d6;\n        }\n        .converter-section {\n            display: none;\n        }\n        .converter-section.active {\n            display: block;\n        }\n        .form-group {\n            display: flex;\n            align-items: center;\n            gap: 15px;\n            margin-bottom: 15px;\n            flex-wrap: wrap;\n        }\n        .form-group flex-1 {\n            flex: 1;\n        }\n        label { display: block; margin-bottom: 6px; font-weight: bold; font-size: 13px; color: #444; }\n        input[type=\"number\"], select {\n            width: 100%;\n            padding: 10px;\n            border: 1px solid #ccc;\n            border-radius: 4px;\n            font-size: 14px;\n            box-sizing: border-box;\n        }\n        .result-box {\n            background: #f6f8fa;\n            padding: 15px;\n            border-radius: 6px;\n            border: 1px solid #e1e4e8;\n            font-size: 16px;\n            font-weight: bold;\n            color: #24292e;\n            margin-top: 15px;\n        }\n        \n        .download-area {\n            margin-top: 30px;\n            padding: 20px;\n            background: #fff;\n            border: 1px solid #e1e4e8;\n            border-radius: 6px;\n            text-align: center;\n        }\n        .download-btn {\n            display: inline-block;\n            background-color: #2ea44f;\n            color: white;\n            padding: 10px 20px;\n            border-radius: 6px;\n            text-decoration: none;\n            font-weight: bold;\n            font-size: 15px;\n        }\n        .download-btn:hover { background-color: #2c974b; }\n        .download-desc {\n            font-size: 13px;\n            color: #586069;\n            margin-top: 8px;\n        }\n    </style>\n</head>\n<body>\n\n    <h1>\u751f\u6d3b\u5e38\u7528\u55ae\u4f4d\u63db\u7b97\u5c0f\u5de5\u5177</h1>\n    \n    <!-- \u4f7f\u7528\u8aaa\u660e\u5340\u584a -->\n    <div class=\"instructions\">\n        <strong>\ud83d\udca1 \u4f7f\u7528\u8aaa\u660e\uff1a</strong>\n        <ol>\n            <li>\u9ede\u64ca\u4e0a\u65b9\u5206\u9801\u5207\u63db\u60a8\u9700\u8981\u7684\u63db\u7b97\u985e\u578b\uff08\u9577\u5ea6\u3001\u91cd\u91cf\u3001\u6eab\u5ea6\u3001\u9762\u7a4d\uff09\u3002</li>\n            <li>\u5728\u8f38\u5165\u6846\u4e2d\u586b\u5165\u6578\u503c\uff0c\u4e26\u9078\u64c7\u5c0d\u61c9\u7684\u55ae\u4f4d\u3002</li>\n            <li>\u7cfb\u7d71\u5c07\u81ea\u52d5\u5373\u6642\u8a08\u7b97\u51fa\u8f49\u63db\u5f8c\u7684\u5404\u9805\u7d50\u679c\u3002</li>\n            <li>\u652f\u63f4\u96a8\u6642\u9ede\u64ca\u4e0b\u65b9\u6309\u9215\u5c07\u6b64\u5de5\u5177\u4e0b\u8f09\u81f3\u672c\u5730\uff0c\u7121\u9700\u806f\u7db2\u96a8\u6642\u53ef\u7528\u3002</li>\n        </ol>\n    </div>\n\n    <div class=\"card\">\n        <!-- \u5206\u9801\u6309\u9215 -->\n        <div class=\"tabs\">\n            <button class=\"tab-btn active\" onclick=\"switchTab('length')\">\ud83d\udccf \u9577\u5ea6\u63db\u7b97</button>\n            <button class=\"tab-btn\" onclick=\"switchTab('weight')\">\u2696\ufe0f \u91cd\u91cf\u63db\u7b97</button>\n            <button class=\"tab-btn\" onclick=\"switchTab('temp')\">\ud83c\udf21\ufe0f \u6eab\u5ea6\u63db\u7b97</button>\n            <button class=\"tab-btn\" onclick=\"switchTab('area')\">\ud83d\udfe9 \u9762\u7a4d\u63db\u7b97</button>\n        </div>\n\n        <!-- 1. \u9577\u5ea6\u63db\u7b97 -->\n        <div id=\"length-section\" class=\"converter-section active\">\n            <div class=\"form-group\">\n                <div style=\"flex: 2;\">\n                    <label>\u6578\u503c</label>\n                    <input type=\"number\" id=\"len-val\" value=\"1\" oninput=\"convertLength()\">\n                </div>\n                <div style=\"flex: 2;\">\n                    <label>\u55ae\u4f4d</label>\n                    <select id=\"len-unit\" onchange=\"convertLength()\">\n                        <option value=\"m\">\u516c\u5c3a (m)</option>\n                        <option value=\"km\">\u516c\u91cc (km)</option>\n                        <option value=\"cm\">\u516c\u5206 (cm)</option>\n                        <option value=\"mm\">\u516c\u91d0 (mm)</option>\n                        <option value=\"mile\">\u82f1\u91cc (mile)</option>\n                        <option value=\"inch\">\u82f1\u540b (inch)</option>\n                        <option value=\"ft\">\u82f1\u5c3a (ft)</option>\n                    </select>\n                </div>\n            </div>\n            <div class=\"result-box\" id=\"len-result\">\u8a08\u7b97\u7d50\u679c\u5448\u73fe\u8655</div>\n        </div>\n\n        <!-- 2. \u91cd\u91cf\u63db\u7b97 -->\n        <div id=\"weight-section\" class=\"converter-section\">\n            <div class=\"form-group\">\n                <div style=\"flex: 2;\">\n                    <label>\u6578\u503c</label>\n                    <input type=\"number\" id=\"wt-val\" value=\"1\" oninput=\"convertWeight()\">\n                </div>\n                <div style=\"flex: 2;\">\n                    <label>\u55ae\u4f4d</label>\n                    <select id=\"wt-unit\" onchange=\"convertWeight()\">\n                        <option value=\"kg\">\u516c\u65a4 (kg)</option>\n                        <option value=\"g\">\u516c\u514b (g)</option>\n                        <option value=\"mg\">\u6beb\u514b (mg)</option>\n                        <option value=\"jin\">\u53f0\u65a4</option>\n                        <option value=\"lb\">\u78c5 (lb)</option>\n                        <option value=\"oz\">\u76ce\u53f8 (oz)</option>\n                    </select>\n                </div>\n            </div>\n            <div class=\"result-box\" id=\"wt-result\">\u8a08\u7b97\u7d50\u679c\u5448\u73fe\u8655</div>\n        </div>\n\n        <!-- 3. \u6eab\u5ea6\u63db\u7b97 -->\n        <div id=\"temp-section\" class=\"converter-section\">\n            <div class=\"form-group\">\n                <div style=\"flex: 2;\">\n                    <label>\u6578\u503c</label>\n                    <input type=\"number\" id=\"temp-val\" value=\"25\" oninput=\"convertTemp()\">\n                </div>\n                <div style=\"flex: 2;\">\n                    <label>\u55ae\u4f4d</label>\n                    <select id=\"temp-unit\" onchange=\"convertTemp()\">\n                        <option value=\"c\">\u651d\u6c0f (\u00b0C)</option>\n                        <option value=\"f\">\u83ef\u6c0f (\u00b0F)</option>\n                        <option value=\"k\">\u51f1\u6c0f (K)</option>\n                    </select>\n                </div>\n            </div>\n            <div class=\"result-box\" id=\"temp-result\">\u8a08\u7b97\u7d50\u679c\u5448\u73fe\u8655</div>\n        </div>\n\n        <!-- 4. \u9762\u7a4d\u63db\u7b97 -->\n        <div id=\"area-section\" class=\"converter-section\">\n            <div class=\"form-group\">\n                <div style=\"flex: 2;\">\n                    <label>\u6578\u503c</label>\n                    <input type=\"number\" id=\"area-val\" value=\"1\" oninput=\"convertArea()\">\n                </div>\n                <div style=\"flex: 2;\">\n                    <label>\u55ae\u4f4d</label>\n                    <select id=\"area-unit\" onchange=\"convertArea()\">\n                        <option value=\"m2\">\u5e73\u65b9\u516c\u5c3a (m\u00b2)</option>\n                        <option value=\"ping\">\u576a (\u53f0\u576a)</option>\n                        <option value=\"mu\">\u5e02\u755d (\u755d)</option>\n                        <option value=\"hectare\">\u516c\u9803 (ha)</option>\n                        <option value=\"km2\">\u5e73\u65b9\u516c\u91cc (km\u00b2)</option>\n                    </select>\n                </div>\n            </div>\n            <div class=\"result-box\" id=\"area-result\">\u8a08\u7b97\u7d50\u679c\u5448\u73fe\u8655</div>\n        </div>\n    </div>\n\n    <!-- \u4f9b\u8b80\u8005\u4e0b\u8f09\u7684\u5340\u584a -->\n    <div class=\"download-area\">\n        <a id=\"downloadLink\" class=\"download-btn\" download=\"\u751f\u6d3b\u5e38\u7528\u55ae\u4f4d\u63db\u7b97\u5c0f\u5de5\u5177.html\">\ud83d\udce5 \u4e0b\u8f09\u6b64\u5de5\u5177\u5230\u672c\u5730\u96e2\u7dda\u4f7f\u7528</a>\n        <p class=\"download-desc\">\u9ede\u64ca\u4e0a\u65b9\u6309\u9215\uff0c\u5373\u53ef\u5c07\u6b64\u5de5\u5177\u5b8c\u6574\u4e0b\u8f09\u5230\u60a8\u7684\u96fb\u8166\u4e2d\uff0c\u7121\u9700\u806f\u7db2\u96a8\u6642\u53ef\u7528\u3002</p>\n    </div>\n\n    <script>\n        function switchTab(tabName) {\n            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));\n            document.querySelectorAll('.converter-section').forEach(sec => sec.classList.remove('active'));\n            \n            event.target.classList.add('active');\n            document.getElementById(tabName + '-section').classList.add('active');\n\n            if(tabName === 'length') convertLength();\n            if(tabName === 'weight') convertWeight();\n            if(tabName === 'temp') convertTemp();\n            if(tabName === 'area') convertArea();\n        }\n\n        // \u9577\u5ea6\u63db\u7b97\u57fa\u6e96\u55ae\u4f4d\uff1a\u516c\u5c3a (m)\n        function convertLength() {\n            const val = parseFloat(document.getElementById('len-val').value) || 0;\n            const unit = document.getElementById('len-unit').value;\n            let meters = val;\n\n            if (unit === 'km') meters = val * 1000;\n            else if (unit === 'cm') meters = val / 100;\n            else if (unit === 'mm') meters = val / 1000;\n            else if (unit === 'mile') meters = val * 1609.344;\n            else if (unit === 'inch') meters = val * 0.0254;\n            else if (unit === 'ft') meters = val * 0.3048;\n\n            document.getElementById('len-result').innerHTML = `\n                \u516c\u5c3a: ${(meters).toFixed(4)} m<br>\n                \u516c\u5206: ${(meters * 100).toFixed(2)} cm<br>\n                \u516c\u91cc: ${(meters / 1000).toFixed(4)} km<br>\n                \u82f1\u540b: ${(meters / 0.0254).toFixed(2)} inch<br>\n                \u82f1\u5c3a: ${(meters / 0.3048).toFixed(2)} ft\n            `;\n        }\n\n        // \u91cd\u91cf\u63db\u7b97\u57fa\u6e96\u55ae\u4f4d\uff1a\u516c\u514b (g)\n        function convertWeight() {\n            const val = parseFloat(document.getElementById('wt-val').value) || 0;\n            const unit = document.getElementById('wt-unit').value;\n            let grams = val;\n\n            if (unit === 'kg') grams = val * 1000;\n            else if (unit === 'mg') grams = val / 1000;\n            else if (unit === 'jin') grams = val * 600; // \u53f0\u65a4\u7d04600\u514b\n            else if (unit === 'lb') grams = val * 453.59237;\n            else if (unit === 'oz') grams = val * 28.34952;\n\n            document.getElementById('wt-result').innerHTML = `\n                \u516c\u514b: ${(grams).toFixed(2)} g<br>\n                \u516c\u65a4: ${(grams / 1000).toFixed(4)} kg<br>\n                \u53f0\u65a4: ${(grams / 600).toFixed(4)} \u53f0\u65a4<br>\n                \u78c5 (lb): ${(grams / 453.59237).toFixed(4)} lb<br>\n                \u76ce\u53f8 (oz): ${(grams / 28.34952).toFixed(2)} oz\n            `;\n        }\n\n        // \u6eab\u5ea6\u63db\u7b97\n        function convertTemp() {\n            const val = parseFloat(document.getElementById('temp-val').value) || 0;\n            const unit = document.getElementById('temp-unit').value;\n            let c = val, f = val, k = val;\n\n            if (unit === 'c') {\n                f = val * 9/5 + 32;\n                k = val + 273.15;\n            } else if (unit === 'f') {\n                c = (val - 32) * 5/9;\n                k = c + 273.15;\n            } else if (unit === 'k') {\n                c = val - 273.15;\n                f = c * 9/5 + 32;\n            }\n\n            document.getElementById('temp-result').innerHTML = `\n                \u651d\u6c0f (\u00b0C): ${c.toFixed(2)} \u00b0C<br>\n                \u83ef\u6c0f (\u00b0F): ${f.toFixed(2)} \u00b0F<br>\n                \u51f1\u6c0f (K): ${k.toFixed(2)} K\n            `;\n        }\n\n        // \u9762\u7a4d\u63db\u7b97\u57fa\u6e96\u55ae\u4f4d\uff1a\u5e73\u65b9\u516c\u5c3a (m2)\n        function convertArea() {\n            const val = parseFloat(document.getElementById('area-val').value) || 0;\n            const unit = document.getElementById('area-unit').value;\n            let m2 = val;\n\n            if (unit === 'ping') m2 = val * 3.305785; // 1\u576a\u7d04 3.3058 \u5e73\u65b9\u516c\u5c3a\n            else if (unit === 'mu') m2 = val * 666.666667; // 1\u755d\u7d04 666.67 \u5e73\u65b9\u516c\u5c3a\n            else if (unit === 'hectare') m2 = val * 10000;\n            else if (unit === 'km2') m2 = val * 1000000;\n\n            document.getElementById('area-result').innerHTML = `\n                \u5e73\u65b9\u516c\u5c3a: ${m2.toFixed(2)} m\u00b2<br>\n                \u576a (\u53f0\u576a): ${(m2 / 3.305785).toFixed(2)} \u576a<br>\n                \u5e02\u755d: ${(m2 / 666.666667).toFixed(4)} \u755d<br>\n                \u516c\u9803: ${(m2 / 10000).toFixed(4)} \u516c\u9803\n            `;\n        }\n\n        // \u521d\u59cb\u5316\u57f7\u884c\n        window.addEventListener('DOMContentLoaded', () => {\n            convertLength();\n            \n            // \u81ea\u52d5\u6253\u5305\u4e0b\u8f09\u908f\u8f2f\n            const htmlContent = document.documentElement.outerHTML;\n            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });\n            const url = URL.createObjectURL(blob);\n            document.getElementById('downloadLink').href = url;\n        });\n    </script>\n\n</body>\n</html>\n",
  "office/bookmark-cleaner": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>\u7db2\u5740\u6536\u85cf\u593e\u4e00\u9375\u6e05\u7406\u8207\u7ba1\u7406\u5de5\u5177 - SY Horizon</title>\n    <style>\n        body {\n            font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n            max-width: 900px;\n            margin: 40px auto;\n            padding: 0 20px;\n            background-color: #f9f9f9;\n            color: #333;\n        }\n        h1 { font-size: 24px; color: #111; margin-bottom: 10px; }\n        .instructions {\n            background: #e1f5fe;\n            padding: 15px 20px;\n            border-radius: 6px;\n            margin-bottom: 20px;\n            font-size: 14px;\n            color: #01579b;\n            border: 1px solid #b3e5fc;\n        }\n        .instructions ol {\n            margin: 8px 0 0 20px;\n            padding: 0;\n            line-height: 1.6;\n        }\n        .card {\n            background: #fff;\n            padding: 20px;\n            border-radius: 6px;\n            border: 1px solid #e1e4e8;\n            margin-bottom: 20px;\n            box-shadow: 0 1px 3px rgba(0,0,0,0.05);\n        }\n        input[type=\"file\"] {\n            margin-bottom: 15px;\n        }\n        .btn-group {\n            display: flex;\n            gap: 10px;\n            margin-bottom: 15px;\n            flex-wrap: wrap;\n        }\n        button {\n            background-color: #2ea44f;\n            color: white;\n            padding: 10px 16px;\n            border: none;\n            border-radius: 6px;\n            font-size: 14px;\n            font-weight: bold;\n            cursor: pointer;\n            transition: background-color 0.2s;\n        }\n        button:hover { background-color: #2c974b; }\n        button.danger { background-color: #d73a49; }\n        button.danger:hover { background-color: #cb2431; }\n        \n        table {\n            width: 100%;\n            border-collapse: collapse;\n            margin-top: 10px;\n        }\n        th, td {\n            border: 1px solid #e1e4e8;\n            padding: 10px;\n            text-align: left;\n            font-size: 13px;\n        }\n        th { background-color: #f6f8fa; }\n        .status-text {\n            font-weight: bold;\n            color: #586069;\n            margin-bottom: 10px;\n        }\n        \n        .download-area {\n            margin-top: 30px;\n            padding: 20px;\n            background: #fff;\n            border: 1px solid #e1e4e8;\n            border-radius: 6px;\n            text-align: center;\n        }\n        .download-btn {\n            display: inline-block;\n            background-color: #0366d6;\n            color: white;\n            padding: 10px 20px;\n            border-radius: 6px;\n            text-decoration: none;\n            font-weight: bold;\n            font-size: 15px;\n        }\n        .download-btn:hover { background-color: #0056b3; }\n        .download-desc {\n            font-size: 13px;\n            color: #586069;\n            margin-top: 8px;\n        }\n    </style>\n</head>\n<body>\n\n    <h1>\u7db2\u5740\u6536\u85cf\u593e\u4e00\u9375\u6e05\u7406\u8207\u7ba1\u7406\u5de5\u5177</h1>\n    \n    <!-- \u4f7f\u7528\u8aaa\u660e\u5340\u584a -->\n    <div class=\"instructions\">\n        <strong>\ud83d\udca1 \u4f7f\u7528\u8aaa\u660e\uff08\u56e0\u700f\u89bd\u5668\u5b89\u5168\u9650\u5236\uff0c\u9700\u900f\u904e\u532f\u51fa\u6a94\u6848\u6e05\u7406\uff09\uff1a</strong>\n        <ol>\n            <li>\u5728\u60a8\u7684\u700f\u89bd\u5668\uff08Chrome/Edge \u7b49\uff09\u8a2d\u5b9a\u4e2d\u9ede\u64ca<strong>\u300c\u532f\u51fa\u66f8\u7c64\u300d</strong>\uff0c\u6703\u5f97\u5230\u4e00\u500b `.html` \u6a94\u6848\u3002</li>\n            <li>\u9ede\u64ca\u4e0b\u65b9\u6309\u9215\u4e0a\u50b3\u8a72\u66f8\u7c64\u6a94\u6848\uff0c\u7cfb\u7d71\u5c07\u81ea\u52d5\u89e3\u6790\u51fa\u6240\u6709\u6536\u85cf\u7684\u7db2\u5740\u3002</li>\n            <li>\u52fe\u9078\u60a8\u60f3\u8981\u522a\u9664\u7684\u7db2\u5740\uff0c\u6216\u9ede\u64ca\u300c\u6279\u6b21\u522a\u9664\u9078\u4e2d\u9805\u76ee\u300d\u3002</li>\n            <li>\u9ede\u64ca\u300c\u5c0e\u51fa\u6e05\u7406\u5f8c\u7684\u66f8\u7c64\u6a94\u6848\u300d\uff0c\u518d\u5c07\u65b0\u6a94\u6848\u532f\u5165\u56de\u700f\u89bd\u5668\u5373\u53ef\u5b8c\u6210\u5927\u6383\u9664\uff01</li>\n            <li>\u652f\u63f4\u96a8\u6642\u9ede\u64ca\u9801\u9762\u6700\u4e0b\u65b9\u6309\u9215\u5c07\u6b64\u5de5\u5177\u4e0b\u8f09\u81f3\u672c\u5730\u96e2\u7dda\u4f7f\u7528\u3002</li>\n        </ol>\n    </div>\n\n    <!-- \u4e0a\u50b3\u8207\u64cd\u4f5c\u9762\u677f -->\n    <div class=\"card\">\n        <label for=\"bookmarkFile\" style=\"font-weight: bold; display: block; margin-bottom: 8px;\">1. \u4e0a\u50b3\u60a8\u7684\u700f\u89bd\u5668\u66f8\u7c64 HTML \u6a94\u6848\uff1a</label>\n        <input type=\"file\" id=\"bookmarkFile\" accept=\".html,.htm\" onchange=\"loadBookmarks(event)\">\n        \n        <div id=\"actionPanel\" style=\"display: none;\">\n            <div class=\"status-text\" id=\"statusText\">\u5df2\u8f09\u5165 0 \u500b\u66f8\u7c64</div>\n            <div class=\"btn-group\">\n                <button onclick=\"selectAll(true)\">\u5168\u9078</button>\n                <button onclick=\"selectAll(false)\">\u53d6\u6d88\u5168\u9078</button>\n                <button class=\"danger\" onclick=\"deleteSelected()\">\ud83d\uddd1\ufe0f \u522a\u9664\u52fe\u9078\u7684\u7db2\u5740</button>\n                <button style=\"background-color: #0366d6;\" onclick=\"exportBookmarks()\">\ud83d\udce5 \u5c0e\u51fa\u6e05\u7406\u5f8c\u7684\u66f8\u7c64\u6a94\u6848</button>\n            </div>\n        </div>\n    </div>\n\n    <!-- \u5217\u8868\u5c55\u793a\u5340 -->\n    <div class=\"card\" id=\"listCard\" style=\"display: none;\">\n        <label style=\"font-weight: bold; margin-bottom: 10px; display: block;\">2. \u66f8\u7c64\u6e05\u55ae\u9810\u89bd\u8207\u52fe\u9078\u522a\u9664</label>\n        <div style=\"max-height: 400px; overflow-y: auto;\">\n            <table>\n                <thead>\n                    <tr>\n                        <th style=\"width: 8%; text-align: center;\">\u9078\u64c7</th>\n                        <th style=\"width: 35%;\">\u66f8\u7c64\u6a19\u984c</th>\n                        <th style=\"width: 57%;\">\u7db2\u5740 (URL)</th>\n                    </tr>\n                </thead>\n                <tbody id=\"bookmarkTableBody\">\n                    <!-- \u52d5\u614b\u8f09\u5165 -->\n                </tbody>\n            </table>\n        </div>\n    </div>\n\n    <!-- \u4f9b\u8b80\u8005\u4e0b\u8f09\u7684\u5340\u584a -->\n    <div class=\"download-area\">\n        <a id=\"downloadLink\" class=\"download-btn\" download=\"\u7db2\u5740\u6536\u85cf\u593e\u6e05\u7406\u5de5\u5177.html\">\ud83d\udce5 \u4e0b\u8f09\u6b64\u5de5\u5177\u5230\u672c\u5730\u96e2\u7dda\u4f7f\u7528</a>\n        <p class=\"download-desc\">\u9ede\u64ca\u4e0a\u65b9\u6309\u9215\uff0c\u5373\u53ef\u5c07\u6b64\u5de5\u5177\u5b8c\u6574\u4e0b\u8f09\u5230\u60a8\u7684\u96fb\u8166\u4e2d\uff0c\u7121\u9700\u806f\u7db2\u96a8\u6642\u53ef\u7528\u3002</p>\n    </div>\n\n    <script>\n        let bookmarks = [];\n\n        function loadBookmarks(event) {\n            const file = event.target.files[0];\n            if (!file) return;\n\n            const reader = new FileReader();\n            reader.onload = function(e) {\n                const htmlContent = e.target.result;\n                parseBookmarksHtml(htmlContent);\n            };\n            reader.readAsText(file);\n        }\n\n        function parseBookmarksHtml(html) {\n            const parser = new DOMParser();\n            const doc = parser.parseFromString(html, 'text/html');\n            const links = doc.querySelectorAll('a');\n            \n            bookmarks = [];\n            links.forEach((a, index) => {\n                bookmarks.push({\n                    id: index,\n                    title: a.textContent || '\u672a\u547d\u540d\u66f8\u7c64',\n                    url: a.href,\n                    selected: false\n                });\n            });\n\n            renderTable();\n            document.getElementById('actionPanel').style.display = 'block';\n            document.getElementById('listCard').style.display = 'block';\n        }\n\n        function renderTable() {\n            const tbody = document.getElementById('bookmarkTableBody');\n            tbody.innerHTML = '';\n            \n            document.getElementById('statusText').innerText = `\u76ee\u524d\u5171\u6709 ${bookmarks.length} \u500b\u66f8\u7c64`;\n\n            if (bookmarks.length === 0) {\n                tbody.innerHTML = '<tr><td colspan=\"3\" style=\"text-align: center; color: #777;\">\u6c92\u6709\u627e\u5230\u4efb\u4f55\u66f8\u7c64\u7d00\u9304</td></tr>';\n                return;\n            }\n\n            bookmarks.forEach((bm, index) => {\n                const tr = document.createElement('tr');\n                tr.innerHTML = `\n                    <td style=\"text-align: center;\"><input type=\"checkbox\" ${bm.selected ? 'checked' : ''} onchange=\"toggleSelect(${index})\"></td>\n                    <td><strong>${escapeHtml(bm.title)}</strong></td>\n                    <td><a href=\"${bm.url}\" target=\"_blank\" style=\"color: #0366d6; text-decoration: none; word-break: break-all;\">${bm.url}</a></td>\n                `;\n                tbody.appendChild(tr);\n            });\n        }\n\n        function toggleSelect(index) {\n            bookmarks[index].selected = !bookmarks[index].selected;\n        }\n\n        function selectAll(select) {\n            bookmarks.forEach(bm => bm.selected = select);\n            renderTable();\n        }\n\n        function deleteSelected() {\n            const initialCount = bookmarks.length;\n            bookmarks = bookmarks.filter(bm => !bm.selected);\n            const deletedCount = initialCount - bookmarks.length;\n            \n            if (deletedCount === 0) {\n                alert('\u8acb\u5148\u52fe\u9078\u8981\u522a\u9664\u7684\u66f8\u7c64\u9805\u76ee\uff01');\n                return;\n            }\n            \n            alert(`\u6210\u529f\u522a\u9664 ${deletedCount} \u500b\u66f8\u7c64\uff01`);\n            renderTable();\n        }\n\n        function exportBookmarks() {\n            let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\\n<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\\n<TITLE>Bookmarks</TITLE>\\n<H1>Bookmarks</H1>\\n<DL><p>\\n`;\n            \n            bookmarks.forEach(bm => {\n                html += `    <DT><A HREF=\"${bm.url}\">${escapeHtml(bm.title)}</A>\\n`;\n            });\n            \n            html += `</DL><p>`;\n\n            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });\n            const url = URL.createObjectURL(blob);\n            const a = document.createElement('a');\n            a.href = url;\n            a.download = 'cleaned_bookmarks.html';\n            document.body.appendChild(a);\n            a.click();\n            document.body.removeChild(a);\n            URL.revokeObjectURL(url);\n        }\n\n        function escapeHtml(str) {\n            return str.replace(/&/g, \"&amp;\").replace(/</g, \"&lt;\").replace(/>/g, \"&gt;\").replace(/\"/g, \"&quot;\").replace(/'/g, \"&#039;\");\n        }\n\n        // \u81ea\u52d5\u5c07\u7576\u524d\u9801\u9762\u7684\u5b8c\u6574\u7a0b\u5f0f\u78bc\u6253\u5305\u6210 Blob\uff0c\u5be6\u73fe\u9ede\u64ca\u5373\u4e0b\u8f09\n        window.addEventListener('DOMContentLoaded', () => {\n            const htmlContent = document.documentElement.outerHTML;\n            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });\n            const url = URL.createObjectURL(blob);\n            const downloadLink = document.getElementById('downloadLink');\n            downloadLink.href = url;\n        });\n    </script>\n\n</body>\n</html>\n",
  "office/url-shortener": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>\u672c\u5730\u7db2\u5740\u5c0d\u61c9\u8207\u7ba1\u7406\u5de5\u5177 - SY Horizon</title>\n    <style>\n        body {\n            font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n            max-width: 800px;\n            margin: 40px auto;\n            padding: 0 20px;\n            background-color: #f9f9f9;\n            color: #333;\n        }\n        h1 { font-size: 24px; color: #111; margin-bottom: 10px; }\n        .instructions {\n            background: #e1f5fe;\n            padding: 15px 20px;\n            border-radius: 6px;\n            margin-bottom: 20px;\n            font-size: 14px;\n            color: #01579b;\n            border: 1px solid #b3e5fc;\n        }\n        .instructions ol {\n            margin: 8px 0 0 20px;\n            padding: 0;\n            line-height: 1.6;\n        }\n        .card {\n            background: #fff;\n            padding: 20px;\n            border-radius: 6px;\n            border: 1px solid #e1e4e8;\n            margin-bottom: 20px;\n            box-shadow: 0 1px 3px rgba(0,0,0,0.05);\n        }\n        label { display: block; margin-bottom: 6px; font-weight: bold; font-size: 14px; color: #444; }\n        input[type=\"text\"] {\n            width: 100%;\n            padding: 10px;\n            border: 1px solid #ccc;\n            border-radius: 4px;\n            font-size: 14px;\n            box-sizing: border-box;\n            margin-bottom: 12px;\n        }\n        button {\n            background-color: #2ea44f;\n            color: white;\n            padding: 10px 16px;\n            border: none;\n            border-radius: 4px;\n            font-size: 14px;\n            font-weight: bold;\n            cursor: pointer;\n        }\n        button:hover { background-color: #2c974b; }\n        table {\n            width: 100%;\n            border-collapse: collapse;\n            margin-top: 10px;\n        }\n        th, td {\n            border: 1px solid #e1e4e8;\n            padding: 10px;\n            text-align: left;\n            font-size: 13px;\n        }\n        th { background-color: #f6f8fa; }\n        .del-btn {\n            background-color: #d73a49;\n            padding: 4px 8px;\n            font-size: 12px;\n        }\n        .del-btn:hover { background-color: #cb2431; }\n        .download-area {\n            text-align: center;\n            margin-top: 30px;\n        }\n        .download-btn {\n            display: inline-block;\n            background-color: #0366d6;\n            color: white;\n            padding: 10px 20px;\n            border-radius: 6px;\n            text-decoration: none;\n            font-weight: bold;\n            font-size: 15px;\n        }\n        .download-btn:hover { background-color: #0056b3; }\n    </style>\n</head>\n<body>\n\n    <h1>\u672c\u5730\u7db2\u5740\u5c0d\u61c9\u8207\u7ba1\u7406\u5de5\u5177</h1>\n    \n    <!-- \u4f7f\u7528\u8aaa\u660e\u5340\u584a -->\n    <div class=\"instructions\">\n        <strong>\ud83d\udca1 \u4f7f\u7528\u8aaa\u660e\uff1a</strong>\n        <ol>\n            <li>\u5728\u300c\u77ed\u4ee3\u865f\u300d\u6b04\u4f4d\u8f38\u5165\u597d\u8a18\u7684\u82f1\u6587\u6216\u7e2e\u5beb\uff08\u4f8b\u5982\uff1a<code>wc</code> \u6216 <code>book1</code>\uff09\u3002</li>\n            <li>\u5728\u300c\u539f\u59cb\u9577\u7db2\u5740\u300d\u6b04\u4f4d\u5b8c\u6574\u8cbc\u4e0a\u60a8\u8981\u8a18\u9304\u6216\u7ba1\u7406\u7684\u7db2\u5740\uff08\u5305\u542b <code>https://</code>\uff09\u3002</li>\n            <li>\u9ede\u64ca\u300c\u65b0\u589e\u5c0d\u61c9\u95dc\u4fc2\u300d\u5373\u53ef\u5132\u5b58\u5230\u700f\u89bd\u5668\u672c\u5730\uff0c\u96a8\u6642\u53ef\u9ede\u64ca\u8a2a\u554f\u6216\u522a\u9664\u3002</li>\n        </ol>\n    </div>\n\n    <!-- \u65b0\u589e\u7e2e\u77ed\u5c0d\u61c9\u8868\u55ae -->\n    <div class=\"card\">\n        <label for=\"shortCode\">\u77ed\u4ee3\u865f</label>\n        <input type=\"text\" id=\"shortCode\" placeholder=\"\u4f8b\u5982\uff1awc\">\n\n        <label for=\"longUrl\">\u539f\u59cb\u9577\u7db2\u5740</label>\n        <input type=\"text\" id=\"longUrl\" placeholder=\"\u4f8b\u5982\uff1ahttps://sylogs.com/...\">\n\n        <button onclick=\"saveUrl()\">\u65b0\u589e\u5c0d\u61c9\u95dc\u4fc2</button>\n    </div>\n\n    <!-- \u5217\u8868\u5c55\u793a\u5340 -->\n    <div class=\"card\">\n        <label>\u5df2\u5132\u5b58\u7684\u7db2\u5740\u5c0d\u61c9\u6e05\u55ae</label>\n        <table>\n            <thead>\n                <tr>\n                    <th style=\"width: 20%;\">\u77ed\u4ee3\u865f</th>\n                    <th style=\"width: 60%;\">\u539f\u59cb\u9577\u7db2\u5740</th>\n                    <th style=\"width: 20%;\">\u64cd\u4f5c</th>\n                </tr>\n            </thead>\n            <tbody id=\"urlTableBody\">\n                <!-- \u52d5\u614b\u8f09\u5165 -->\n            </tbody>\n        </table>\n    </div>\n\n    <!-- \u96e2\u7dda\u4e0b\u8f09\u5340 -->\n    <div class=\"download-area\">\n        <a id=\"downloadLink\" class=\"download-btn\" download=\"\u672c\u5730\u7db2\u5740\u7e2e\u77ed\u5de5\u5177.html\">\ud83d\udce5 \u4e0b\u8f09\u6b64\u5de5\u5177\u5230\u672c\u5730\u96e2\u7dda\u4f7f\u7528</a>\n    </div>\n\n    <script>\n        // \u8f09\u5165\u672c\u5730\u5132\u5b58\u7684\u8cc7\u6599\n        function loadUrls() {\n            const urls = JSON.parse(localStorage.getItem('sy_short_urls') || '{}');\n            const tbody = document.getElementById('urlTableBody');\n            tbody.innerHTML = '';\n\n            if (Object.keys(urls).length === 0) {\n                tbody.innerHTML = '<tr><td colspan=\"3\" style=\"text-align: center; color: #777;\">\u5c1a\u7121\u4efb\u4f55\u7db2\u5740\u7d00\u9304</td></tr>';\n                return;\n            }\n\n            for (let code in urls) {\n                const url = urls[code];\n                const tr = document.createElement('tr');\n                tr.innerHTML = `\n                    <td><strong>${code}</strong></td>\n                    <td><a href=\"${url}\" target=\"_blank\" style=\"color: #0366d6; text-decoration: none; word-break: break-all;\">${url}</a></td>\n                    <td>\n                        <button class=\"del-btn\" onclick=\"deleteUrl('${code}')\">\u522a\u9664</button>\n                    </td>\n                `;\n                tbody.appendChild(tr);\n            }\n        }\n\n        // \u5132\u5b58\u65b0\u7db2\u5740\n        function saveUrl() {\n            const code = document.getElementById('shortCode').value.trim();\n            const url = document.getElementById('longUrl').value.trim();\n\n            if (!code || !url) {\n                alert('\u8acb\u5b8c\u6574\u586b\u5beb\u77ed\u4ee3\u865f\u8207\u539f\u59cb\u9577\u7db2\u5740\uff01');\n                return;\n            }\n\n            let urls = JSON.parse(localStorage.getItem('sy_short_urls') || '{}');\n            urls[code] = url;\n            localStorage.setItem('sy_short_urls', JSON.stringify(urls));\n\n            document.getElementById('shortCode').value = '';\n            document.getElementById('longUrl').value = '';\n            loadUrls();\n        }\n\n        // \u522a\u9664\u7db2\u5740\n        function deleteUrl(code) {\n            if (confirm(`\u78ba\u5b9a\u8981\u522a\u9664\u4ee3\u865f \u300c${code}\u300d \u55ce\uff1f`)) {\n                let urls = JSON.parse(localStorage.getItem('sy_short_urls') || '{}');\n                delete urls[code];\n                localStorage.setItem('sy_short_urls', JSON.stringify(urls));\n                loadUrls();\n            }\n        }\n\n        // \u9801\u9762\u8f09\u5165\u6642\u57f7\u884c\n        window.addEventListener('DOMContentLoaded', () => {\n            loadUrls();\n            \n            // \u6253\u5305\u4e0b\u8f09\u908f\u8f2f\n            const htmlContent = document.documentElement.outerHTML;\n            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });\n            const url = URL.createObjectURL(blob);\n            document.getElementById('downloadLink').href = url;\n        });\n    </script>\n\n</body>\n</html>\n",
  "writing/word-counter": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>Markdown \u6587\u672c\u5b57\u6578\u8207\u95b1\u8b80\u6642\u9593\u7d71\u8a08\u5668 - SY Horizon</title>\n    <style>\n        body {\n            font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n            max-width: 800px;\n            margin: 40px auto;\n            padding: 0 20px;\n            background-color: #f9f9f9;\n            color: #333;\n        }\n        h1 { font-size: 24px; color: #111; margin-bottom: 10px; }\n        .instructions {\n            background: #e1f5fe;\n            padding: 15px 20px;\n            border-radius: 6px;\n            margin-bottom: 20px;\n            font-size: 14px;\n            color: #01579b;\n            border: 1px solid #b3e5fc;\n        }\n        .instructions ol {\n            margin: 8px 0 0 20px;\n            padding: 0;\n            line-height: 1.6;\n        }\n        textarea {\n            width: 100%;\n            height: 250px;\n            padding: 12px;\n            border: 1px solid #ccc;\n            border-radius: 6px;\n            font-size: 14px;\n            font-family: monospace;\n            resize: vertical;\n            box-sizing: border-box;\n        }\n        .stats-box {\n            display: flex;\n            gap: 15px;\n            margin-top: 20px;\n            flex-wrap: wrap;\n        }\n        .stat-card {\n            background: #fff;\n            padding: 15px 20px;\n            border-radius: 6px;\n            border: 1px solid #e1e4e8;\n            flex: 1;\n            min-width: 150px;\n            box-shadow: 0 1px 3px rgba(0,0,0,0.05);\n        }\n        .stat-card h3 { margin: 0 0 5px 0; font-size: 13px; color: #586069; }\n        .stat-card p { margin: 0; font-size: 20px; font-weight: bold; color: #0366d6; }\n        \n        .download-area {\n            margin-top: 30px;\n            padding: 20px;\n            background: #fff;\n            border: 1px solid #e1e4e8;\n            border-radius: 6px;\n            text-align: center;\n        }\n        .download-btn {\n            display: inline-block;\n            background-color: #2ea44f;\n            color: white;\n            padding: 10px 20px;\n            border-radius: 6px;\n            text-decoration: none;\n            font-weight: bold;\n            font-size: 15px;\n            transition: background-color 0.2s;\n        }\n        .download-btn:hover {\n            background-color: #2c974b;\n        }\n        .download-desc {\n            font-size: 13px;\n            color: #586069;\n            margin-top: 8px;\n        }\n    </style>\n</head>\n<body>\n\n    <h1>Markdown \u6587\u672c\u5b57\u6578\u8207\u95b1\u8b80\u6642\u9593\u7d71\u8a08\u5668</h1>\n    \n    <!-- \u4f7f\u7528\u8aaa\u660e\u5340\u584a -->\n    <div class=\"instructions\">\n        <strong>\ud83d\udca1 \u4f7f\u7528\u8aaa\u660e\uff1a</strong>\n        <ol>\n            <li>\u5728\u4e0b\u65b9\u6587\u5b57\u6846\u4e2d\u76f4\u63a5\u8cbc\u4e0a\u60a8\u7684 Markdown \u6216\u4e00\u822c\u6587\u7ae0\u5167\u5bb9\u3002</li>\n            <li>\u7cfb\u7d71\u6703\u5373\u6642\u81ea\u52d5\u8a08\u7b97**\u7e3d\u5b57\u6578\uff08\u542b\u6a19\u9ede\uff09**\u8207**\u7d14\u4e2d\u6587\u5b57\u6578**\u3002</li>\n            <li>\u6839\u64da\u4e2d\u6587\u5b57\u6578\uff08\u4ee5\u6bcf\u5206\u9418\u7d04 400 \u5b57\u8a08\u7b97\uff09\uff0c\u81ea\u52d5\u8a55\u4f30\u51fa\u9810\u4f30\u95b1\u8b80\u6642\u9593\u3002</li>\n            <li>\u9ede\u64ca\u4e0b\u65b9\u6309\u9215\u53ef\u96a8\u6642\u4e0b\u8f09\u96e2\u7dda\u7248\u672c\uff0c\u65b9\u4fbf\u96a8\u6642\u96a8\u5730\u4f7f\u7528\u3002</li>\n        </ol>\n    </div>\n\n    <textarea id=\"textInput\" placeholder=\"\u5728\u6b64\u8f38\u5165\u6216\u8cbc\u4e0a\u6587\u5b57...\" oninput=\"calculateStats()\"></textarea>\n\n    <div class=\"stats-box\">\n        <div class=\"stat-card\">\n            <h3>\u7e3d\u5b57\u6578\uff08\u542b\u6a19\u9ede\uff09</h3>\n            <p id=\"charCount\">0</p>\n        </div>\n        <div class=\"stat-card\">\n            <h3>\u7d14\u4e2d\u6587\u5b57\u6578</h3>\n            <p id=\"cnCharCount\">0</p>\n        </div>\n        <div class=\"stat-card\">\n            <h3>\u9810\u4f30\u95b1\u8b80\u6642\u9593</h3>\n            <p id=\"readTime\">0 \u5206\u9418</p>\n        </div>\n    </div>\n\n    <!-- \u4f9b\u8b80\u8005\u4e0b\u8f09\u7684\u5340\u584a -->\n    <div class=\"download-area\">\n        <a id=\"downloadLink\" class=\"download-btn\" download=\"Markdown\u6587\u672c\u5b57\u6578\u7d71\u8a08\u5de5\u5177.html\">\ud83d\udce5 \u4e0b\u8f09\u6b64\u5de5\u5177\u5230\u672c\u5730\u96e2\u7dda\u4f7f\u7528</a>\n        <p class=\"download-desc\">\u9ede\u64ca\u4e0a\u65b9\u6309\u9215\uff0c\u5373\u53ef\u5c07\u6b64\u5de5\u5177\u5b8c\u6574\u4e0b\u8f09\u5230\u60a8\u7684\u96fb\u8166\u4e2d\uff0c\u7121\u9700\u806f\u7db2\u96a8\u6642\u53ef\u7528\u3002</p>\n    </div>\n\n    <script>\n        function calculateStats() {\n            const text = document.getElementById('textInput').value;\n            const charCount = text.length;\n            const cnMatches = text.match(/[\\u4e00-\\u9fa5]/g);\n            const cnCharCount = cnMatches ? cnMatches.length : 0;\n            const readTime = Math.ceil(cnCharCount / 400);\n\n            document.getElementById('charCount').innerText = charCount;\n            document.getElementById('cnCharCount').innerText = cnCharCount;\n            document.getElementById('readTime').innerText = readTime + ' \u5206\u9418';\n        }\n\n        // \u81ea\u52d5\u5c07\u7576\u524d\u9801\u9762\u7684\u5b8c\u6574\u7a0b\u5f0f\u78bc\u6253\u5305\u6210 Blob\uff0c\u5be6\u73fe\u9ede\u64ca\u5373\u4e0b\u8f09\n        window.addEventListener('DOMContentLoaded', () => {\n            const htmlContent = document.documentElement.outerHTML;\n            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });\n            const url = URL.createObjectURL(blob);\n            const downloadLink = document.getElementById('downloadLink');\n            downloadLink.href = url;\n        });\n    </script>\n\n</body>\n</html>\n",
  "writing/tc-sc-converter": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>\u7e41\u7c21\u9ad4\u4e2d\u6587\u7dda\u4e0a\u8f49\u63db\u5de5\u5177 - SY Horizon</title>\n    <style>\n        body {\n            font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n            max-width: 800px;\n            margin: 40px auto;\n            padding: 0 20px;\n            background-color: #f9f9f9;\n            color: #333;\n        }\n        h1 { font-size: 24px; color: #111; margin-bottom: 10px; }\n        .instructions {\n            background: #e1f5fe;\n            padding: 15px 20px;\n            border-radius: 6px;\n            margin-bottom: 20px;\n            font-size: 14px;\n            color: #01579b;\n            border: 1px solid #b3e5fc;\n        }\n        .instructions ol {\n            margin: 8px 0 0 20px;\n            padding: 0;\n            line-height: 1.6;\n        }\n        .editor-container {\n            display: flex;\n            gap: 20px;\n            flex-wrap: wrap;\n            margin-bottom: 20px;\n        }\n        .pane {\n            flex: 1;\n            min-width: 320px;\n            display: flex;\n            flex-direction: column;\n        }\n        .pane label {\n            font-weight: bold;\n            font-size: 14px;\n            margin-bottom: 6px;\n            color: #444;\n        }\n        textarea {\n            width: 100%;\n            height: 250px;\n            padding: 12px;\n            border: 1px solid #ccc;\n            border-radius: 6px;\n            font-size: 14px;\n            font-family: monospace;\n            resize: vertical;\n            box-sizing: border-box;\n        }\n        .btn-group {\n            display: flex;\n            gap: 10px;\n            margin-bottom: 20px;\n            flex-wrap: wrap;\n        }\n        button {\n            background-color: #2ea44f;\n            color: white;\n            padding: 10px 18px;\n            border: none;\n            border-radius: 6px;\n            font-size: 14px;\n            font-weight: bold;\n            cursor: pointer;\n            transition: background-color 0.2s;\n        }\n        button:hover { background-color: #2c974b; }\n        button.secondary {\n            background-color: #6f42c1;\n        }\n        button.secondary:hover { background-color: #5a32a3; }\n        button.clear-btn {\n            background-color: #d73a49;\n        }\n        button.clear-btn:hover { background-color: #cb2431; }\n        .download-area {\n            margin-top: 30px;\n            padding: 20px;\n            background: #fff;\n            border: 1px solid #e1e4e8;\n            border-radius: 6px;\n            text-align: center;\n        }\n        .download-btn {\n            display: inline-block;\n            background-color: #0366d6;\n            color: white;\n            padding: 10px 20px;\n            border-radius: 6px;\n            text-decoration: none;\n            font-weight: bold;\n            font-size: 15px;\n        }\n        .download-btn:hover { background-color: #0056b3; }\n        .download-desc {\n            font-size: 13px;\n            color: #586069;\n            margin-top: 8px;\n        }\n    </style>\n</head>\n<body>\n\n    <h1>\u7e41\u7c21\u9ad4\u4e2d\u6587\u7dda\u4e0a\u8f49\u63db\u5de5\u5177</h1>\n    \n    <!-- \u4f7f\u7528\u8aaa\u660e\u5340\u584a -->\n    <div class=\"instructions\">\n        <strong>\ud83d\udca1 \u4f7f\u7528\u8aaa\u660e\uff1a</strong>\n        <ol>\n            <li>\u5728\u5de6\u5074\u6587\u5b57\u6846\u4e2d\u8cbc\u4e0a\u60a8\u9700\u8981\u8f49\u63db\u7684\u4e2d\u6587\u6587\u7ae0\u6216\u6bb5\u843d\u3002</li>\n            <li>\u9ede\u64ca\u300c\u8f49\u70ba\u7c21\u9ad4\u4e2d\u6587\u300d\u6216\u300c\u8f49\u70ba\u7e41\u9ad4\u4e2d\u6587\u300d\u6309\u9215\uff0c\u53f3\u5074\u5c07\u7acb\u5373\u5448\u73fe\u8f49\u63db\u7d50\u679c\u3002</li>\n            <li>\u9ede\u64ca\u300c\u4e00\u9375\u8907\u88fd\u300d\u53ef\u5feb\u901f\u5c07\u8f49\u63db\u597d\u7684\u6587\u5b57\u8907\u88fd\u5230\u526a\u8cbc\u7c3f\u4e2d\u3002</li>\n            <li>\u652f\u63f4\u96a8\u6642\u9ede\u64ca\u4e0b\u65b9\u6309\u9215\u5c07\u6b64\u5de5\u5177\u4e0b\u8f09\u81f3\u672c\u5730\u96e2\u7dda\u4f7f\u7528\u3002</li>\n        </ol>\n    </div>\n\n    <!-- \u5de6\u53f3\u96d9\u6b04\u7de8\u8f2f\u5340 -->\n    <div class=\"editor-container\">\n        <div class=\"pane\">\n            <label for=\"sourceText\">\u539f\u59cb\u6587\u672c</label>\n            <textarea id=\"sourceText\" placeholder=\"\u8acb\u5728\u6b64\u8f38\u5165\u6216\u8cbc\u4e0a\u8981\u8f49\u63db\u7684\u6587\u5b57...\"></textarea>\n        </div>\n        <div class=\"pane\">\n            <label for=\"targetText\">\u8f49\u63db\u7d50\u679c</label>\n            <textarea id=\"targetText\" placeholder=\"\u8f49\u63db\u5f8c\u7684\u6587\u5b57\u5c07\u986f\u793a\u5728\u9019\u88e1...\" readonly></textarea>\n        </div>\n    </div>\n\n    <!-- \u529f\u80fd\u64cd\u4f5c\u6309\u9215 -->\n    <div class=\"btn-group\">\n        <button onclick=\"convertToSimple()\">\u8f49\u70ba\u7c21\u9ad4\u4e2d\u6587 \u2193</button>\n        <button class=\"secondary\" onclick=\"convertToTraditional()\">\u8f49\u70ba\u7e41\u9ad4\u4e2d\u6587 \u2193</button>\n        <button onclick=\"copyResult()\">\ud83d\udccb \u8907\u88fd\u7d50\u679c</button>\n        <button class=\"clear-btn\" onclick=\"clearAll()\">\u6e05\u7a7a\u5167\u5bb9</button>\n    </div>\n\n    <!-- \u4f9b\u8b80\u8005\u4e0b\u8f09\u7684\u5340\u584a -->\n    <div class=\"download-area\">\n        <a id=\"downloadLink\" class=\"download-btn\" download=\"\u7e41\u7c21\u9ad4\u4e2d\u6587\u8f49\u63db\u5de5\u5177.html\">\ud83d\udce5 \u4e0b\u8f09\u6b64\u5de5\u5177\u5230\u672c\u5730\u96e2\u7dda\u4f7f\u7528</a>\n        <p class=\"download-desc\">\u9ede\u64ca\u4e0a\u65b9\u6309\u9215\uff0c\u5373\u53ef\u5c07\u6b64\u5de5\u5177\u5b8c\u6574\u4e0b\u8f09\u5230\u60a8\u7684\u96fb\u8166\u4e2d\uff0c\u7121\u9700\u806f\u7db2\u96a8\u6642\u53ef\u7528\u3002</p>\n    </div>\n\n    <script>\n        // \u7c21\u6613\u5167\u7f6e\u7e41\u7c21\u5b57\u5eab\u5c0d\u61c9\u8868\uff08\u6838\u5fc3\u5e38\u7528\u5b57\u8207\u8a5e\u7d44\uff09\n        const s2tDict = {\n            \"\u4f18\": \"\u512a\", \"\u4f53\": \"\u4f53\", \"\u513f\": \"\u5152\", \"\u5173\": \"\u95dc\", \"\u5199\": \"\u5beb\", \"\u51c6\": \"\u6e96\", \"\u5218\": \"\u5289\", \"\u521a\": \"\u525b\", \"\u521b\": \"\u5275\", \"\u52a8\": \"\u52d5\", \"\u53d1\": \"\u767c\", \"\u53d8\": \"\u8b8a\", \"\u53f0\": \"\u81fa\", \"\u540e\": \"\u5f8c\", \"\u542c\": \"\u807d\", \"\u56fd\": \"\u570b\", \"\u56fe\": \"\u5716\", \"\u5708\": \"\u5708\", \"\u574f\": \"\u58de\", \"\u575a\": \"\u5805\", \"\u5904\": \"\u8655\", \"\u5907\": \"\u5099\", \"\u590d\": \"\u5fa9\", \"\u5934\": \"\u982d\", \"\u5956\": \"\u734e\", \"\u5988\": \"\u5abd\", \"\u5987\": \"\u5a66\", \"\u5b9d\": \"\u5bf6\", \"\u5b9e\": \"\u5be6\", \"\u5bf9\": \"\u5c0d\", \"\u4e13\": \"\u5c08\", \"\u5bfc\": \"\u5c0e\", \"\u5c14\": \"\u723e\", \"\u5c81\": \"\u6b72\", \"\u5de5\u4e1a\": \"\u5de5\u696d\", \"\u5e7f\": \"\u5ee3\", \"\u5e86\": \"\u6176\", \"\u5f53\": \"\u7576\", \"\u5f55\": \"\u9304\", \"\u5fc6\": \"\u61b6\", \"\u6000\": \"\u61f7\", \"\u6001\": \"\u614b\", \"\u6052\": \"\u6046\", \"\u6076\": \"\u60e1\", \"\u607c\": \"\u60f1\", \"\u60f3\": \"\u60f3\", \"\u7231\": \"\u611b\", \"\u611f\u8c22\": \"\u611f\u8b1d\", \"\u6218\": \"\u6230\", \"\u6240\": \"\u6240\", \"\u624d\": \"\u624d\", \"\u6267\": \"\u57f7\", \"\u626b\": \"\u6383\", \"\u6269\": \"\u64f4\", \"\u65e7\": \"\u820a\", \"\u65f6\": \"\u6642\", \"\u665a\": \"\u665a\", \"\u6653\": \"\u66c9\", \"\u6765\": \"\u4f86\", \"\u6807\": \"\u6a19\", \"\u6837\": \"\u6a23\", \"\u6865\": \"\u6a4b\", \"\u6863\": \"\u6a94\", \"\u6865\": \"\u6a4b\", \"\u6b22\": \"\u6b61\", \"\u6bb5\": \"\u6bb5\", \"\u6bcd\": \"\u6bcd\", \"\u6c14\": \"\u6c23\", \"\u6c34\": \"\u6c34\", \"\u6c49\": \"\u6f22\", \"\u6c64\": \"\u6e6f\", \"\u70b9\": \"\u9ede\", \"\u70ed\": \"\u71b1\", \"\u7231\": \"\u611b\", \"\u73b0\": \"\u73fe\", \"\u73af\": \"\u74b0\", \"\u4ea7\": \"\u7522\", \"\u7535\": \"\u96fb\", \"\u7545\": \"\u66a2\", \"\u754c\": \"\u754c\", \"\u53d1\": \"\u767c\", \"\u786e\": \"\u78ba\", \"\u7801\": \"\u78bc\", \"\u793e\": \"\u793e\", \"\u793c\": \"\u79ae\", \"\u7f51\": \"\u7db2\", \"\u7f57\": \"\u7f85\", \"\u7f8e\": \"\u7f8e\", \"\u7fa4\": \"\u7fa4\", \"\u8111\": \"\u8166\", \"\u810f\": \"\u81df\", \"\u4e0e\": \"\u8207\", \"\u4e07\": \"\u842c\", \"\u53f6\": \"\u8449\", \"\u85cf\": \"\u85cf\", \"\u53f7\": \"\u865f\", \"\u89c1\": \"\u898b\", \"\u89c2\": \"\u89c0\", \"\u89c4\": \"\u898f\", \"\u89c6\": \"\u8996\", \"\u8bdd\": \"\u8a71\", \"\u8be5\": \"\u8a72\", \"\u8be6\": \"\u8a73\", \"\u8bed\": \"\u8a9e\", \"\u8c01\": \"\u8ab0\", \"\u8c03\": \"\u8abf\", \"\u8d1f\": \"\u8ca0\", \"\u8d22\": \"\u8ca1\", \"\u8d28\": \"\u8cea\", \"\u8d2d\": \"\u8cfc\", \"\u8f6c\": \"\u8f49\", \"\u8f6f\": \"\u8edf\", \"\u8f7b\": \"\u8f15\", \"\u9002\": \"\u9069\", \"\u9009\": \"\u9078\", \"\u9012\": \"\u905e\", \"\u91c7\": \"\u63a1\", \"\u91cc\": \"\u88e1\", \"\u91cd\": \"\u91cd\", \"\u957f\": \"\u9577\", \"\u95e8\": \"\u9580\", \"\u95ee\": \"\u554f\", \"\u95f4\": \"\u9593\", \"\u9605\": \"\u95b1\", \"\u968f\": \"\u96a8\", \"\u9690\": \"\u96b1\", \"\u96be\": \"\u96e3\", \"\u9876\": \"\u9802\", \"\u987a\": \"\u9806\", \"\u996d\": \"\u98ef\", \"\u9970\": \"\u98fe\", \"\u9986\": \"\u9928\", \"\u9a6c\": \"\u99ac\", \"\u9a71\": \"\u9a45\", \"\u9a8c\": \"\u9a57\", \"\u4f53\": \"\u9ad4\", \"\u9e23\": \"\u9cf4\", \"\u9f84\": \"\u9f61\", \"\u70b9\": \"\u9ede\"\n        };\n\n        // \u53cd\u8f49\u751f\u6210\u7c21\u9ad4\u5c0d\u61c9\u8868\n        const t2sDict = {};\n        for (let s in s2tDict) {\n            t2sDict[s2tDict[s]] = s;\n        }\n\n        function translateText(text, dict) {\n            let result = \"\";\n            for (let i = 0; i < text.length; i++) {\n                let char = text[i];\n                result += dict[char] || char;\n            }\n            return result;\n        }\n\n        function convertToTraditional() {\n            const text = document.getElementById('sourceText').value;\n            document.getElementById('targetText').value = translateText(text, s2tDict);\n        }\n\n        function convertToSimple() {\n            const text = document.getElementById('sourceText').value;\n            document.getElementById('targetText').value = translateText(text, t2sDict);\n        }\n\n        function copyResult() {\n            const target = document.getElementById('targetText');\n            if (!target.value) {\n                alert('\u6c92\u6709\u53ef\u8907\u88fd\u7684\u5167\u5bb9\uff01');\n                return;\n            }\n            target.select();\n            document.execCommand('copy');\n            alert('\u5df2\u6210\u529f\u8907\u88fd\u8f49\u63db\u7d50\u679c\u5230\u526a\u8cbc\u7c3f\uff01');\n        }\n\n        function clearAll() {\n            document.getElementById('sourceText').value = '';\n            document.getElementById('targetText').value = '';\n        }\n\n        // \u81ea\u52d5\u5c07\u7576\u524d\u9801\u9762\u7684\u5b8c\u6574\u7a0b\u5f0f\u78bc\u6253\u5305\u6210 Blob\uff0c\u5be6\u73fe\u9ede\u64ca\u5373\u4e0b\u8f09\n        window.addEventListener('DOMContentLoaded', () => {\n            const htmlContent = document.documentElement.outerHTML;\n            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });\n            const url = URL.createObjectURL(blob);\n            document.getElementById('downloadLink').href = url;\n        });\n    </script>\n\n</body>\n</html>\n",
  "writing/text-to-speech": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>\u6587\u5b57\u8f49\u8a9e\u97f3\u8207\u6717\u8b80\u9810\u89bd\u5c0f\u5e6b\u624b - SY Horizon</title>\n    <style>\n        body {\n            font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n            max-width: 800px;\n            margin: 40px auto;\n            padding: 0 20px;\n            background-color: #f9f9f9;\n            color: #333;\n        }\n        h1 { font-size: 24px; color: #111; margin-bottom: 10px; }\n        .instructions {\n            background: #e1f5fe;\n            padding: 15px 20px;\n            border-radius: 6px;\n            margin-bottom: 20px;\n            font-size: 14px;\n            color: #01579b;\n            border: 1px solid #b3e5fc;\n        }\n        .instructions ol {\n            margin: 8px 0 0 20px;\n            padding: 0;\n            line-height: 1.6;\n        }\n        .card {\n            background: #fff;\n            padding: 20px;\n            border-radius: 6px;\n            border: 1px solid #e1e4e8;\n            margin-bottom: 20px;\n            box-shadow: 0 1px 3px rgba(0,0,0,0.05);\n        }\n        textarea {\n            width: 100%;\n            height: 200px;\n            padding: 12px;\n            border: 1px solid #ccc;\n            border-radius: 6px;\n            font-size: 14px;\n            font-family: inherit;\n            resize: vertical;\n            box-sizing: border-box;\n            margin-bottom: 15px;\n        }\n        .control-group {\n            display: flex;\n            gap: 20px;\n            margin-bottom: 20px;\n            flex-wrap: wrap;\n        }\n        .control-item {\n            flex: 1;\n            min-width: 200px;\n        }\n        label { display: block; margin-bottom: 6px; font-weight: bold; font-size: 13px; color: #444; }\n        select, input[type=\"range\"] {\n            width: 100%;\n            padding: 8px;\n            border: 1px solid #ccc;\n            border-radius: 4px;\n            font-size: 14px;\n            box-sizing: border-box;\n        }\n        .btn-group {\n            display: flex;\n            gap: 10px;\n            flex-wrap: wrap;\n        }\n        button {\n            background-color: #2ea44f;\n            color: white;\n            padding: 10px 20px;\n            border: none;\n            border-radius: 6px;\n            font-size: 14px;\n            font-weight: bold;\n            cursor: pointer;\n            transition: background-color 0.2s;\n        }\n        button:hover { background-color: #2c974b; }\n        button.pause-btn { background-color: #f69833; }\n        button.pause-btn:hover { background-color: #e28725; }\n        button.stop-btn { background-color: #d73a49; }\n        button.stop-btn:hover { background-color: #cb2431; }\n        \n        .download-area {\n            margin-top: 30px;\n            padding: 20px;\n            background: #fff;\n            border: 1px solid #e1e4e8;\n            border-radius: 6px;\n            text-align: center;\n        }\n        .download-btn {\n            display: inline-block;\n            background-color: #0366d6;\n            color: white;\n            padding: 10px 20px;\n            border-radius: 6px;\n            text-decoration: none;\n            font-weight: bold;\n            font-size: 15px;\n        }\n        .download-btn:hover { background-color: #0056b3; }\n        .download-desc {\n            font-size: 13px;\n            color: #586069;\n            margin-top: 8px;\n        }\n    </style>\n</head>\n<body>\n\n    <h1>\u6587\u5b57\u8f49\u8a9e\u97f3\u8207\u6717\u8b80\u9810\u89bd\u5c0f\u5e6b\u624b</h1>\n    \n    <!-- \u4f7f\u7528\u8aaa\u660e\u5340\u584a -->\n    <div class=\"instructions\">\n        <strong>\ud83d\udca1 \u4f7f\u7528\u8aaa\u660e\uff1a</strong>\n        <ol>\n            <li>\u5728\u4e0b\u65b9\u6587\u5b57\u6846\u4e2d\u8f38\u5165\u6216\u8cbc\u4e0a\u60a8\u60f3\u8981\u8046\u807d\u7684\u6587\u7ae0\u3001\u6bb5\u843d\u6216\u53e5\u5b50\u3002</li>\n            <li>\u53ef\u900f\u904e\u4e0b\u65b9\u9078\u55ae\u9078\u64c7\u60a8\u559c\u6b61\u7684\u8a9e\u97f3\u767c\u97f3\u4eba\uff0c\u4e26\u81ea\u7531\u8abf\u6574\u6717\u8b80\u8a9e\u901f\u3002</li>\n            <li>\u9ede\u64ca\u300c\u958b\u59cb\u6717\u8b80\u300d\u5373\u53ef\u8046\u807d\uff0c\u96a8\u6642\u53ef\u9032\u884c\u66ab\u505c\u6216\u505c\u6b62\u3002</li>\n            <li>\u652f\u63f4\u9ede\u64ca\u4e0b\u65b9\u6309\u9215\u5c07\u6b64\u5de5\u5177\u4e0b\u8f09\u81f3\u672c\u5730\uff0c\u7121\u9700\u806f\u7db2\u96a8\u6642\u53ef\u7528\u3002</li>\n        </ol>\n    </div>\n\n    <!-- \u6838\u5fc3\u64cd\u4f5c\u9762\u677f -->\n    <div class=\"card\">\n        <textarea id=\"textInput\" placeholder=\"\u8acb\u5728\u6b64\u8f38\u5165\u8981\u6717\u8b80\u7684\u6587\u5b57\u5167\u5bb9...\">\u6b61\u8fce\u4f7f\u7528 SY Horizon \u7684\u6587\u5b57\u8f49\u8a9e\u97f3\u5c0f\u5e6b\u624b\u3002\u9019\u662f\u4e00\u500b\u652f\u63f4\u96e2\u7dda\u4f7f\u7528\u7684\u7db2\u9801\u6717\u8b80\u5de5\u5177\uff0c\u60a8\u53ef\u4ee5\u96a8\u6642\u5728\u9019\u88e1\u9810\u89bd\u6587\u7ae0\u7684\u8a9e\u97f3\u6548\u679c\u3002</textarea>\n\n        <div class=\"control-group\">\n            <div class=\"control-item\">\n                <label for=\"voiceSelect\">\u9078\u64c7\u767c\u97f3\u4eba / \u8a9e\u8a00</label>\n                <select id=\"voiceSelect\"></select>\n            </div>\n            <div class=\"control-item\">\n                <label for=\"rateRange\">\u8a9e\u901f\u8abf\u6574: <span id=\"rateValue\">1.0</span>x</label>\n                <input type=\"range\" id=\"rateRange\" min=\"0.5\" max=\"2\" step=\"0.1\" value=\"1.0\" oninput=\"updateRateLabel()\">\n            </div>\n        </div>\n\n        <div class=\"btn-group\">\n            <button onclick=\"speakText()\">\u25b6 \u958b\u59cb\u6717\u8b80</button>\n            <button class=\"pause-btn\" onclick=\"pauseSpeech()\">\u23f8 \u66ab\u505c/\u7e7c\u7e8c</button>\n            <button class=\"stop-btn\" onclick=\"stopSpeech()\">\u23f9 \u505c\u6b62</button>\n        </div>\n    </div>\n\n    <!-- \u4f9b\u8b80\u8005\u4e0b\u8f09\u7684\u5340\u584a -->\n    <div class=\"download-area\">\n        <a id=\"downloadLink\" class=\"download-btn\" download=\"\u6587\u5b57\u8f49\u8a9e\u97f3\u6717\u8b80\u5c0f\u5e6b\u624b.html\">\ud83d\udce5 \u4e0b\u8f09\u6b64\u5de5\u5177\u5230\u672c\u5730\u96e2\u7dda\u4f7f\u7528</a>\n        <p class=\"download-desc\">\u9ede\u64ca\u4e0a\u65b9\u6309\u9215\uff0c\u5373\u53ef\u5c07\u6b64\u5de5\u5177\u5b8c\u6574\u4e0b\u8f09\u5230\u60a8\u7684\u96fb\u8166\u4e2d\uff0c\u7121\u9700\u806f\u7db2\u96a8\u6642\u53ef\u7528\u3002</p>\n    </div>\n\n    <script>\n        const synth = window.speechSynthesis;\n        let voices = [];\n\n        function populateVoiceList() {\n            voices = synth.getVoices();\n            const voiceSelect = document.getElementById('voiceSelect');\n            voiceSelect.innerHTML = '';\n            \n            // \u512a\u5148\u7be9\u9078\u4e2d\u6587\u6216\u82f1\u6587\u767c\u97f3\n            voices.forEach((voice, i) => {\n                const option = document.createElement('option');\n                option.textContent = `${voice.name} (${voice.lang})`;\n                if (voice.default) {\n                    option.textContent += ' \u2014 \u9810\u8a2d';\n                }\n                option.setAttribute('data-lang', voice.lang);\n                option.setAttribute('data-name', voice.name);\n                voiceSelect.appendChild(option);\n            });\n        }\n\n        populateVoiceList();\n        if (synth.onvoiceschanged !== undefined) {\n            synth.onvoiceschanged = populateVoiceList;\n        }\n\n        function updateRateLabel() {\n            const rate = document.getElementById('rateRange').value;\n            document.getElementById('rateValue').innerText = rate;\n        }\n\n        function speakText() {\n            if (synth.speaking) {\n                synth.cancel();\n            }\n\n            const text = document.getElementById('textInput').value;\n            if (!text.trim()) {\n                alert('\u8acb\u5148\u8f38\u5165\u8981\u6717\u8b80\u7684\u6587\u5b57\uff01');\n                return;\n            }\n\n            const utterThis = new SpeechSynthesisUtterance(text);\n            const selectedOption = document.getElementById('voiceSelect').selectedOptions[0];\n            \n            if (selectedOption) {\n                const targetName = selectedOption.getAttribute('data-name');\n                for (let i = 0; i < voices.length; i++) {\n                    if (voices[i].name === targetName) {\n                        utterThis.voice = voices[i];\n                        break;\n                    }\n                }\n            }\n\n            utterThis.rate = parseFloat(document.getElementById('rateRange').value);\n            synth.speak(utterThis);\n        }\n\n        function pauseSpeech() {\n            if (synth.speaking) {\n                if (synth.paused) {\n                    synth.resume();\n                } else {\n                    synth.pause();\n                }\n            }\n        }\n\n        function stopSpeech() {\n            if (synth.speaking) {\n                synth.cancel();\n            }\n        }\n\n        // \u81ea\u52d5\u5c07\u7576\u524d\u9801\u9762\u7684\u5b8c\u6574\u7a0b\u5f0f\u78bc\u6253\u5305\u6210 Blob\uff0c\u5be6\u73fe\u9ede\u64ca\u5373\u4e0b\u8f09\n        window.addEventListener('DOMContentLoaded', () => {\n            const htmlContent = document.documentElement.outerHTML;\n            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });\n            const url = URL.createObjectURL(blob);\n            document.getElementById('downloadLink').href = url;\n        });\n    </script>\n\n</body>\n</html>\n",
};

// V75-FIX: 免費工具子頁面也強制繪製頂部導覽列(附帶獨立迷你樣式,不依賴主站 BASE_STYLE),
// 避免進入工具頁後導覽列消失、無法返回其他頁面
const TOOL_NAV_STYLE = `
<style>
  .topnav {
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.6rem;
    background: #1a1a1a; color: #fff; padding: 0.6rem 1rem; border-radius: 6px; margin-bottom: 1.2rem;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .topnav ul { list-style: none; display: flex; flex-wrap: wrap; gap: 0.9rem; margin: 0; padding: 0; }
  .topnav ul li { margin: 0; }
  .topnav a { color: #fff; text-decoration: none; font-size: 0.9rem; }
  .topnav a:hover { text-decoration: underline; }
  .lang-select select { background: #333; color: #fff; border: 1px solid #555; border-radius: 4px; padding: 0.25rem 0.5rem; font-size: 0.85rem; }
  /* V77: 工具頁也要支援菜鳥之友下拉/行動版選單(覆蓋上方 .topnav ul 的 flex 規則) */
  .topnav .nav-row { display: flex; align-items: center; justify-content: space-between; width: 100%; flex-wrap: wrap; gap: 0.6rem; }
  .topnav .nav-dropdown { position: relative; }
  .topnav .dropdown-menu { display: none; position: absolute; top: 100%; left: 0; min-width: 165px; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; padding: 0.3rem 0; flex-direction: column; gap: 0; list-style: none; margin: 0; z-index: 20; }
  .topnav .nav-dropdown:hover .dropdown-menu, .topnav .nav-dropdown:focus-within .dropdown-menu { display: flex; }
  .topnav .dropdown-menu a { padding: 0.4rem 0.8rem; white-space: nowrap; }
  .topnav .nav-mobile { display: none; width: 100%; flex-direction: column; gap: 0; border-top: 1px solid #444; list-style: none; margin: 0; padding: 0.3rem 0 0.2rem 0; }
  .topnav .nav-mobile.open { display: flex; }
  .topnav .nav-mobile > li > a, .topnav .nav-mobile-toggle { display: block; width: 100%; text-align: left; background: none; border: none; color: #fff; padding: 0.5rem 0.3rem; font-size: 0.9rem; cursor: pointer; }
  .topnav .nav-mobile-children { display: none; flex-direction: column; gap: 0; list-style: none; margin: 0; padding-left: 1rem; }
  .topnav .nav-mobile-children.open { display: flex; }
  .topnav .nav-burger { display: none; background: none; border: 1px solid #666; color: #fff; border-radius: 4px; padding: 0.25rem 0.5rem; cursor: pointer; font-size: 1rem; }
  @media (max-width: 860px) { .topnav .nav-burger { display: inline-block; } .topnav .nav-links { display: none; } }
</style>`;

function renderToolFile(slug, lang) {
  const html = TOOL_PAGES[slug];
  if (!html) return new Response("Not Found", { status: 404 });
  const safeLang = lang || "zh-Hant";
  let out = html;
  // 注入頂部導覽列(導覽列永遠存在)
  if (out.includes("<body>")) {
    out = out.replace("<body>", `<body>\n${TOOL_NAV_STYLE}\n${buildNav(safeLang, "/tools/" + slug)}\n`);
  }
  // 同步 <html lang> 屬性,避免英文版被標記為中文影響SEO
  out = out.replace('<html lang="zh-CN">', `<html lang="${safeLang}">`);
  return new Response(out, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
