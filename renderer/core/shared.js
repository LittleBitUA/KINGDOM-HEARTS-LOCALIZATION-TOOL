// Спільні чисті модулі (shared/*.js, UMD → window.KH), реекспорт для ESM.
export const ts = window.KH.textStructure;
export const preserveStructure = ts.preserveStructure;
export const tokensOf = ts.tokensOf;
// KH1: оригінал уже з іменованими токенами (`{wait 90}`), а переклади,
// зроблені раніше, ще з `{0x05,0x5A}` — порівнюємо обидві сторони у сирій формі,
// інакше кожен старий рядок виглядав би як «зламані токени».
const kh1 = (window.KH && window.KH.kh1Tokens) || null;
export const kh1RawTokens = kh1 ? kh1.rawTokens : ((s) => s);
export const validateTokens = kh1
  ? ((en, uk) => ts.validateTokens(kh1.rawTokens(en), kh1.rawTokens(uk)))
  : ts.validateTokens;
export const bbsNormalizeTags = ts.bbsNormalizeTags;
export const bbsShapeMatch = ts.bbsShapeMatch;
export const tokenIssueText = ts.tokenIssueText;
export const segmentByTokens = ts.segmentByTokens;
export const autoFixStructure = ts.autoFixStructure;
export const syncPaddingFromEn = ts.syncPaddingFromEn;
export const LETTER_RE = ts.LETTER_RE;
export const tsvFormat = window.KH.tsv;
export const kh1OutRel = ts.kh1OutRel;
export const patchOutRel = ts.patchOutRel;
