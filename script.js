'use strict';

/* ==========================================================================
 * My Tasks: 할 일 관리 앱
 *
 * 설계 요약
 *  - 상태 원본은 모듈 범위의 `todos` 배열 하나뿐입니다.
 *    항목 형태: { id, text, completed, category, createdAt(ISO 문자열) }
 *    배열 순서가 곧 '직접 정렬(manual)' 모드의 순서이고, 새 항목은 맨 앞에 들어갑니다.
 *  - 상태를 바꾸는 함수는 모두 `todos 수정 → saveTodos() → render()` 순서를 따릅니다.
 *  - saveTodos()는 디바운스됩니다. 연속으로 바뀌면 마지막 한 번만 localStorage에 쓰고,
 *    페이지를 떠날 때(pagehide / visibilitychange)는 즉시 flush 합니다.
 *  - render()는 id별로 캐시한 <li>를 재사용합니다. 내용이 바뀐 항목만 갱신하고,
 *    위치가 달라진 노드만 옮깁니다. 그래서 항목이 수백 개여도 전체를 다시 만들지 않습니다.
 *  - 목록 이벤트(체크, 삭제, 드래그, 키보드 이동)는 #todo-list에 붙인 위임 리스너로만 처리합니다.
 *  - 사용자 입력은 항상 textContent로 넣습니다. innerHTML은 쓰지 않습니다(XSS 방지).
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * 1. 상수
 * ------------------------------------------------------------------------ */

/** localStorage 키 */
const STORAGE_KEY = 'todos';
const FILTER_KEY = 'todo_filter';
const THEME_KEY = 'todo_theme';
const SORT_KEY = 'todo_sort';
/** 저장된 데이터가 손상됐을 때 덮어쓰기 전에 원본을 보관하는 키 */
const CORRUPT_BACKUP_KEY = 'todos_corrupted_backup';

const MAX_TEXT_LENGTH = 200;              // 할 일 한 개의 최대 글자 수
const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 가져오기 파일 최대 크기(5MB)
const MAX_IMPORT_ITEMS = 10000;           // 가져오기 최대 항목 수
const SAVE_DEBOUNCE_MS = 300;             // 저장 디바운스 간격
const SEARCH_DEBOUNCE_MS = 200;           // 검색 디바운스 간격
const UNDO_LIMIT = 20;                    // 실행 취소 기록 최대 개수
const TOAST_DURATION_MS = 6000;           // 토스트 표시 시간
const TIME_REFRESH_MS = 60 * 1000;        // 'n분 전' 표시 갱신 주기

/** 내보내기 파일 형식 식별자. 가져오기 때 버전 확인에 씁니다. */
const EXPORT_APP_ID = 'my-tasks';
const EXPORT_VERSION = 1;

const CATEGORY_MAP = {
  work: '업무',
  personal: '개인',
  study: '공부',
};
/** 카테고리순 정렬과 대시보드 표시 순서 */
const CATEGORY_ORDER = Object.keys(CATEGORY_MAP);
const CATEGORY_COLORS = {
  work: '#4A90E2',
  personal: '#27AE60',
  study: '#8E44AD',
};
/** 알 수 없는 카테고리를 가진 데이터를 불러오면 이 값으로 바꿉니다. */
const DEFAULT_CATEGORY = 'personal';
const VALID_FILTERS = ['all', ...CATEGORY_ORDER];

const SORT_LABELS = {
  status: '완료 상태순',
  created: '생성일순',
  category: '카테고리순',
  manual: '직접 정렬',
};
/** 기본값은 이전 버전과 같은 '미완료 먼저, 최신순'입니다. */
const DEFAULT_SORT = 'status';

/**
 * 키워드 기반 자동 카테고리 분류 사전.
 * - strong(2점): 그 카테고리를 강하게 암시하는 단어. weak(1점): 힌트 정도인 단어.
 *   예) '점심 미팅'은 점심(개인, 1점) < 미팅(업무, 2점)이므로 업무로 분류됩니다.
 * - 한글은 부분 문자열로 비교하므로 조사나 어미가 붙어도('회의를', '운동하기') 잡힙니다.
 *   그래서 다른 단어 안에 흔히 들어가는 짧은 단어(예: '책' → '책상', '정책')는 넣지 않습니다.
 * - 영문은 단어 경계(\b)로 비교해서 'art'가 'start'에 걸리는 일을 막습니다.
 * - 모두 소문자로 적습니다(비교할 때 입력도 소문자로 바꿉니다).
 */
const CATEGORY_KEYWORDS = {
  work: {
    strong: ['회의', '미팅', '보고서', '업무', '프로젝트', '출장', '결재', '기획서', '제안서', '기안',
      '거래처', '클라이언트', '고객사', '마감', '계약', '견적', '발표 자료', '세미나', '야근', '출근',
      '팀장', '인보이스', '매출', '실적', '워크샵', '면접', 'meeting', 'report', 'deadline', 'client', 'ppt'],
    weak: ['메일', '발표', '회사', '팀', '상사', '엑셀', '슬랙', '문서', '일정 조율', 'email', 'excel'],
  },
  personal: {
    strong: ['장보기', '마트', '운동', '헬스', '병원', '치과', '약국', '생일', '청소', '빨래', '설거지',
      '요리', '산책', '여행', '데이트', '쇼핑', '택배', '미용실', '요가', '필라테스', '등산', '공과금',
      '이사', '선물', '가족', '엄마', '아빠', '부모님', '반려', '강아지', '고양이', 'gym'],
    weak: ['약속', '친구', '영화', '저녁', '점심', '은행', '집', '주말', '휴가', '카페'],
  },
  study: {
    strong: ['공부', '복습', '예습', '강의', '인강', '수업', '과제', '숙제', '시험', '독서', '학원',
      '토익', '토플', '자격증', '챕터', '문제집', '튜토리얼', '알고리즘', '논문', '스터디', '레포트',
      '단어 암기', '기출', 'javascript', 'python', 'study', 'lecture', 'homework'],
    weak: ['책 읽기', '읽기', '영어', '단어', '코딩', '정리 노트', '노트 정리', '연습', '배우기', 'course'],
  },
};

/** 자동 분류 켜기/끄기 설정을 저장하는 키 */
const AUTO_CATEGORY_KEY = 'todo_auto_category';
/** 입력이 멈춘 뒤 분류할 때까지 기다리는 시간 */
const CLASSIFY_DEBOUNCE_MS = 150;

/** 오늘의 격언 목록 */
const QUOTES = [
  { text: '천 리 길도 한 걸음부터.', author: '속담' },
  { text: '시작이 반이다.', author: '속담' },
  { text: '티끌 모아 태산.', author: '속담' },
  { text: '늦었다고 생각할 때가 가장 빠른 때다.', author: '속담' },
  { text: '오늘 할 수 있는 일을 내일로 미루지 마라.', author: '벤저민 프랭클린' },
  { text: '멈추지 않는 이상, 얼마나 천천히 가는지는 문제가 되지 않는다.', author: '공자' },
  { text: '성공은 매일 반복한 작은 노력들의 합이다.', author: '로버트 콜리어' },
  { text: '할 수 있다고 믿든 할 수 없다고 믿든, 당신이 옳다.', author: '헨리 포드' },
  { text: '행동은 모든 성공의 기본 열쇠다.', author: '파블로 피카소' },
  { text: '작은 기회로부터 종종 위대한 업적이 시작된다.', author: '데모스테네스' },
  { text: '완벽함이 아니라 꾸준함을 목표로 하라.', author: '작자 미상' },
  { text: '해야 할 일을 하라. 그러면 할 수 있는 힘이 생긴다.', author: '랄프 왈도 에머슨' },
  { text: '가장 좋은 시작 방법은 말을 멈추고 행동하는 것이다.', author: '월트 디즈니' },
  { text: '하루하루를 마지막 날처럼 살되, 영원히 살 것처럼 배워라.', author: '마하트마 간디' },
];

/* --------------------------------------------------------------------------
 * 2. DOM 참조
 *    마크업과 스크립트가 어긋나면 나중에 엉뚱한 곳에서 터지지 않도록 바로 알려 줍니다.
 * ------------------------------------------------------------------------ */

/**
 * id로 요소를 찾고, 없으면 즉시 에러를 던집니다.
 * @param {string} id
 * @returns {HTMLElement}
 */
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`필수 요소 #${id} 를 찾을 수 없습니다. index.html을 확인하세요.`);
  return el;
}

const form = $('todo-form');
const input = $('todo-input');
const inputMessage = $('input-message');
const categorySelect = $('category-select');
const categoryHint = $('category-hint');
const autoCategoryToggle = $('auto-category-toggle');
const list = $('todo-list');
const emptyMessage = $('empty-message');
const footer = $('todo-footer');
const todoCount = $('todo-count');
const clearCompletedBtn = $('clear-completed');
const filterNav = $('filter-nav');
const sortSelect = $('sort-select');
const totalProgressText = $('total-progress-text');
const totalProgressBar = $('total-progress-bar');
const totalProgressFill = $('total-progress-fill');
const cheerMessage = $('cheer-message');
const todayCount = $('today-count');
const categoryProgressList = $('category-progress-list');
const themeToggle = $('theme-toggle');
const searchInput = $('search-input');
const remainingBadge = $('remaining-badge');
const quoteText = $('quote-text');
const quoteAuthor = $('quote-author');
const quoteNextBtn = $('quote-next');
const exportBtn = $('export-btn');
const importBtn = $('import-btn');
const importFile = $('import-file');
const importDialog = $('import-dialog');
const importSummary = $('import-summary');
const importBackup = $('import-backup');
const importWarning = $('import-warning');
const toast = $('toast');
const toastMessage = $('toast-message');
const toastUndo = $('toast-undo');
const toastClose = $('toast-close');
const srStatus = $('sr-status');
const srAlert = $('sr-alert');

/* --------------------------------------------------------------------------
 * 3. 범용 유틸리티
 * ------------------------------------------------------------------------ */

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * 디바운스: 마지막 호출 후 wait(ms) 동안 추가 호출이 없을 때 한 번만 실행합니다.
 * 반환된 함수에는 flush(대기 중이면 즉시 실행), cancel, pending 메서드가 붙어 있습니다.
 * @param {Function} fn
 * @param {number} wait
 */
function debounce(fn, wait) {
  let timer = null;
  function debounced() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, wait);
  }
  debounced.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    fn();
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  debounced.pending = () => timer !== null;
  return debounced;
}

/**
 * localStorage 래퍼.
 * 사파리 사생활 보호 모드, 저장소 차단, 용량 초과 같은 상황에서 예외가 나도 앱이 멈추지 않게 합니다.
 */
const storage = {
  /** @returns {string|null} 실패하면 null */
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      console.warn(`localStorage 읽기 실패 (${key}):`, err);
      return null;
    }
  },
  /** @returns {boolean} 성공 여부 */
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      console.error(`localStorage 쓰기 실패 (${key}):`, err);
      return false;
    }
  },
};

/** 고유 id를 만듭니다. randomUUID를 쓸 수 없는 환경(비보안 컨텍스트 등)에서는 대체 방식을 씁니다. */
function generateId() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
  } catch {
    /* 대체 방식으로 진행 */
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * 할 일 텍스트를 정리합니다.
 * - 제어 문자를 제거하고, 연속 공백은 하나로 줄이고, 앞뒤 공백을 지웁니다.
 * - 최대 길이를 넘으면 자릅니다. 이모지 같은 서로게이트 쌍이 반으로 잘리지 않도록 Array.from을 씁니다.
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeText(value) {
  const collapsed = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(collapsed);
  return chars.length > MAX_TEXT_LENGTH
    ? chars.slice(0, MAX_TEXT_LENGTH).join('').trim()
    : collapsed;
}

/** 중복 확인과 검색에 쓰는 비교용 키(대소문자 무시) */
function toKey(text) {
  return text.toLocaleLowerCase('ko');
}

/** 긴 문자열을 알림 메시지용으로 줄입니다. */
function truncate(text, max = 30) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') + '…' : text;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 로컬 시간 기준 'YYYY-MM-DD' */
function localDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 파일 이름용 타임스탬프 'YYYY-MM-DD_HHmm' */
function fileTimestamp() {
  const d = new Date();
  return `${localDateKey(d)}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

/** 문자열을 간단한 32비트 정수 해시로 바꿉니다. 날짜별 격언 선택에 씁니다. */
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * ISO 날짜를 '방금 전', 'n분 전' 같은 상대 시간으로 바꿉니다.
 * 기기 시계가 어긋나 미래 시각이 들어와도 '방금 전'으로 표시합니다.
 */
function timeAgo(dateString) {
  const past = new Date(dateString);
  const time = past.getTime();
  if (!Number.isFinite(time)) return '';
  const diff = Math.floor((Date.now() - time) / 1000);

  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}일 전`;
  return past.toLocaleDateString();
}

/** 입력 중인 요소인지 확인합니다. 단축키가 타이핑을 가로채지 않게 할 때 씁니다. */
function isEditable(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(el.type);
  }
  return false;
}

/* --------------------------------------------------------------------------
 * 4-0. 키워드 기반 자동 카테고리 분류
 *   normalizeTodo(불러오기, 가져오기)와 입력 폼에서 함께 씁니다.
 * ------------------------------------------------------------------------ */

/** 정규식 특수문자를 이스케이프합니다(키워드를 정규식에 안전하게 넣기 위해). */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 키워드 사전을 비교 함수 목록으로 한 번만 컴파일합니다.
 * 분류는 키를 누를 때마다 실행되므로, 정규식은 미리 만들어 둡니다.
 * @returns {{ category: string, keyword: string, weight: number, test: (lower: string) => boolean }[]}
 */
function buildCategoryRules(dictionary) {
  const rules = [];
  for (const [category, groups] of Object.entries(dictionary)) {
    if (!hasOwn(CATEGORY_MAP, category)) continue; // 사전 오타로 없는 카테고리가 생기지 않게
    for (const [group, weight] of [['strong', 2], ['weak', 1]]) {
      for (const raw of groups[group] || []) {
        const keyword = String(raw).trim().toLocaleLowerCase('ko');
        if (!keyword) continue;
        // 영문/숫자로만 된 키워드는 단어 경계로, 한글이 섞인 키워드는 부분 문자열로 비교합니다.
        const test = /^[a-z0-9 ]+$/.test(keyword)
          ? ((re) => (lower) => re.test(lower))(new RegExp(`\\b${escapeRegExp(keyword)}\\b`))
          : (lower) => lower.includes(keyword);
        rules.push({ category, keyword, weight, test });
      }
    }
  }
  return rules;
}

const CATEGORY_RULES = buildCategoryRules(CATEGORY_KEYWORDS);

/**
 * 텍스트의 키워드로 카테고리를 추정합니다.
 * @param {string} text
 * @returns {null | { category: string, keywords: string[] } | { category: null, ambiguous: string[] }}
 *   - null: 일치하는 키워드 없음
 *   - category가 있음: 가장 점수가 높은 카테고리와, 근거가 된 키워드(점수 높은 순)
 *   - category가 null: 여러 카테고리가 동점이라 판단 보류(ambiguous에 후보 목록)
 */
function classifyText(text) {
  const lower = String(text ?? '').toLocaleLowerCase('ko');
  if (!lower.trim()) return null;

  const scores = {};
  const matched = {};
  for (const rule of CATEGORY_RULES) {
    if (!rule.test(lower)) continue;
    scores[rule.category] = (scores[rule.category] || 0) + rule.weight;
    if (!matched[rule.category]) matched[rule.category] = [];
    matched[rule.category].push(rule);
  }

  const entries = Object.entries(scores);
  if (entries.length === 0) return null;

  const bestScore = Math.max(...entries.map(([, s]) => s));
  const winners = entries.filter(([, s]) => s === bestScore).map(([c]) => c);
  if (winners.length > 1) {
    // 동점이면 잘못 고르는 것보다 사용자에게 맡기는 편이 낫습니다.
    return { category: null, ambiguous: CATEGORY_ORDER.filter((c) => winners.includes(c)) };
  }

  const category = winners[0];
  const keywords = matched[category]
    .sort((a, b) => b.weight - a.weight)
    .map((r) => r.keyword);
  return { category, keywords };
}

/* --------------------------------------------------------------------------
 * 4. 데이터 검증 및 정규화
 *    localStorage, 가져온 파일, 다른 탭 등 외부에서 들어온 데이터는 모두 이 함수들을 거칩니다.
 * ------------------------------------------------------------------------ */

/**
 * 임의의 값을 올바른 todo 객체로 바꿉니다. 쓸 수 없는 값이면 null을 반환합니다.
 * 예전 버전 데이터(category 없음)도 기본 카테고리를 붙여 받아들입니다.
 * @param {unknown} raw
 * @returns {{id:string,text:string,completed:boolean,category:string,createdAt:string}|null}
 */
function normalizeTodo(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.text !== 'string') return null;

  const text = sanitizeText(raw.text);
  if (!text) return null;

  let id = null;
  if (typeof raw.id === 'string' && raw.id.trim()) id = raw.id.trim();
  else if (typeof raw.id === 'number' && Number.isFinite(raw.id)) id = String(raw.id);

  const createdTime = Date.parse(raw.createdAt);

  // 카테고리가 없거나 알 수 없는 값이면(예전 데이터, 다른 앱에서 가져온 파일)
  // 텍스트 키워드로 추정하고, 그래도 모르면 기본 카테고리를 씁니다.
  const category = typeof raw.category === 'string' && hasOwn(CATEGORY_MAP, raw.category)
    ? raw.category
    : classifyText(text)?.category || DEFAULT_CATEGORY;

  return {
    id: id || generateId(),
    text,
    completed: raw.completed === true,
    category,
    // ISO 형식으로 통일해 두면 정렬할 때 문자열 비교만으로 시간순이 맞습니다.
    createdAt: Number.isFinite(createdTime)
      ? new Date(createdTime).toISOString()
      : new Date().toISOString(),
  };
}

/**
 * 배열 전체를 정규화합니다. 잘못된 항목은 건너뛰고, 중복된 id에는 새 id를 줍니다.
 * @param {unknown[]} rawList
 * @returns {{ todos: ReturnType<typeof normalizeTodo>[], skipped: number }}
 */
function normalizeTodoList(rawList) {
  const result = [];
  const seenIds = new Set();
  let skipped = 0;

  for (const raw of rawList) {
    const todo = normalizeTodo(raw);
    if (!todo) {
      skipped++;
      continue;
    }
    if (seenIds.has(todo.id)) todo.id = generateId();
    seenIds.add(todo.id);
    result.push(todo);
  }
  return { todos: result, skipped };
}

/**
 * localStorage에 저장된 문자열을 todo 배열로 바꿉니다.
 * @param {string|null} raw
 * @returns {{ todos: object[], error: Error|null }}
 */
function parseStoredTodos(raw) {
  if (raw === null || raw === '') return { todos: [], error: null };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('저장된 데이터가 배열이 아닙니다.');
    return { todos: normalizeTodoList(parsed).todos, error: null };
  } catch (err) {
    return { todos: [], error: err };
  }
}

/* --------------------------------------------------------------------------
 * 5. 저장 및 불러오기
 * ------------------------------------------------------------------------ */

/** 앱 시작 직후 사용자에게 보여 줄 경고. 데이터 손상 등이 있을 때 채워집니다. */
let startupNotice = null;

function loadTodos() {
  const raw = storage.get(STORAGE_KEY);
  const { todos: loaded, error } = parseStoredTodos(raw);
  if (error) {
    console.error('저장된 할 일을 불러오지 못했습니다:', error);
    // 다음 저장 때 손상된 원본이 덮어써져 사라지지 않도록 따로 보관합니다.
    storage.set(CORRUPT_BACKUP_KEY, raw);
    startupNotice = '저장된 데이터가 손상되어 빈 목록으로 시작합니다. (원본은 따로 보관했습니다)';
  }
  return loaded;
}

/** 저장 실패 알림을 한 번만 보여 주기 위한 플래그. 실패할 때마다 띄우면 너무 시끄럽습니다. */
let storageErrorNotified = false;

/** 실제로 localStorage에 씁니다. 직접 부르지 말고 saveTodos()를 쓰세요. */
function writeTodosNow() {
  const ok = storage.set(STORAGE_KEY, JSON.stringify(todos));
  if (ok) {
    storageErrorNotified = false;
  } else if (!storageErrorNotified) {
    storageErrorNotified = true;
    showToast('저장하지 못했습니다. 저장 공간이 부족하거나 브라우저가 저장을 막고 있습니다. 내보내기로 백업해 두세요.', { type: 'error' });
  }
}

const scheduleWrite = debounce(writeTodosNow, SAVE_DEBOUNCE_MS);

/** 저장을 예약합니다(디바운스). 상태를 바꾸는 모든 함수에서 render() 전에 호출합니다. */
function saveTodos() {
  scheduleWrite();
}

/** 예약된 저장을 즉시 실행합니다. 페이지 이탈, 내보내기 직전에 씁니다. */
function flushSave() {
  scheduleWrite.flush();
}

/* --------------------------------------------------------------------------
 * 6. 앱 상태
 * ------------------------------------------------------------------------ */

/** @type {{ id: string, text: string, completed: boolean, category: string, createdAt: string }[]} */
let todos = loadTodos();

let currentFilter = VALID_FILTERS.includes(storage.get(FILTER_KEY)) ? storage.get(FILTER_KEY) : 'all';
let currentSort = hasOwn(SORT_LABELS, storage.get(SORT_KEY) ?? '') ? storage.get(SORT_KEY) : DEFAULT_SORT;
/** 검색어(이미 소문자로 정리된 값). 빈 문자열이면 검색하지 않습니다. */
let searchQuery = '';
let currentTheme = 'light';

/**
 * 실행 취소 스택.
 * - { type: 'remove', label, items: [{ todo, index }] }: 삭제된 항목을 원래 위치에 되돌립니다.
 * - { type: 'snapshot', label, previous }: 배열 전체를 이전 상태로 되돌립니다(가져오기).
 */
let undoStack = [];

/** 중복 경고를 한 번 띄운 텍스트의 키. 같은 텍스트로 다시 제출하면 추가를 허용합니다. */
let duplicateConfirmKey = null;

/** 키워드 자동 분류 사용 여부(기본: 켜짐) */
let autoCategoryEnabled = storage.get(AUTO_CATEGORY_KEY) !== '0';
/** 지금 입력 중인 할 일에 대해 사용자가 카테고리를 직접 골랐는지. 골랐다면 자동 분류가 덮어쓰지 않습니다. */
let categoryManuallySet = false;
/**
 * 자동 분류가 적용되지 않을 때 돌아갈 카테고리.
 * 사용자가 마지막으로 직접 고른 값이고, 처음에는 select의 기본값입니다.
 * 키워드를 지우면 이 값으로 되돌아갑니다.
 */
let baseCategory = categorySelect.value;

/** 확인 대화상자를 기다리는 가져오기 데이터 */
let pendingImport = null;

/** 최근 렌더링 때의 완료율. 100% 달성 순간을 감지해 축하 알림을 줄 때 씁니다. */
let lastPercent = null;

/** 방금 추가된 항목의 id. 이 항목에만 등장 애니메이션을 줍니다. */
const newItemIds = new Set();

/**
 * id → 해당 항목의 DOM 요소 캐시.
 * signature가 같으면 DOM을 건드리지 않아서 렌더링 비용을 크게 줄입니다.
 * @type {Map<string, {li:HTMLLIElement, handle:HTMLButtonElement, checkbox:HTMLInputElement,
 *   text:HTMLSpanElement, tag:HTMLSpanElement, time:HTMLTimeElement, del:HTMLButtonElement, signature:string}>}
 */
const elementCache = new Map();

/** 드래그 중인 상태 */
const drag = { id: null, targetLi: null, position: null };

/** 카테고리별 진행률 DOM 참조(한 번 만들고 값만 갱신) */
const categoryStatRefs = {};

/* --------------------------------------------------------------------------
 * 7. 알림: 스크린 리더 / 토스트
 * ------------------------------------------------------------------------ */

/**
 * 스크린 리더에 메시지를 읽어 줍니다.
 * 같은 문구를 연달아 넣어도 다시 읽도록 잠깐 비웠다가 넣습니다.
 * @param {string} message
 * @param {{ assertive?: boolean }} [options] assertive이면 지금 읽는 내용을 끊고 바로 읽습니다(오류용).
 */
function announce(message, { assertive = false } = {}) {
  const region = assertive ? srAlert : srStatus;
  region.textContent = '';
  setTimeout(() => {
    region.textContent = message;
  }, 50);
}

let toastTimer = null;

/**
 * 화면 하단에 토스트를 띄우고 스크린 리더에도 알립니다.
 * @param {string} message
 * @param {{ undo?: boolean, type?: 'info'|'success'|'error' }} [options]
 */
function showToast(message, { undo = false, type = 'info' } = {}) {
  toastMessage.textContent = message;
  toastUndo.hidden = !undo;
  toast.dataset.type = type;
  toast.hidden = false;
  announce(undo ? `${message}. 실행 취소하려면 Ctrl+Z를 누르세요.` : message, { assertive: type === 'error' });
  startToastTimer();
}

function hideToast() {
  clearTimeout(toastTimer);
  toastTimer = null;
  // 토스트 안에 포커스가 있었다면 사라지는 요소에 포커스가 남지 않도록 입력창으로 옮깁니다.
  const hadFocus = toast.contains(document.activeElement);
  toast.hidden = true;
  if (hadFocus) input.focus();
}

function startToastTimer() {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_DURATION_MS);
}

/** 마우스를 올리거나 포커스가 있으면 토스트가 사라지지 않게 멈춥니다(읽을 시간 보장). */
function pauseToastTimer() {
  clearTimeout(toastTimer);
  toastTimer = null;
}

/* --------------------------------------------------------------------------
 * 8. 실행 취소(Undo)
 * ------------------------------------------------------------------------ */

function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

/** 가장 최근의 되돌릴 수 있는 작업(삭제, 완료 항목 삭제, 가져오기)을 되돌립니다. */
function undo() {
  const entry = undoStack.pop();
  if (!entry) {
    showToast('되돌릴 작업이 없습니다.');
    return;
  }

  if (entry.type === 'remove') {
    // 원래 인덱스의 오름차순으로 끼워 넣어야 삭제 전 순서가 정확히 복원됩니다.
    const existingIds = new Set(todos.map((t) => t.id));
    const items = [...entry.items].sort((a, b) => a.index - b.index);
    for (const { todo, index } of items) {
      if (existingIds.has(todo.id)) continue; // 다른 탭 동기화 등으로 이미 있으면 건너뜀
      todos.splice(Math.min(index, todos.length), 0, todo);
      existingIds.add(todo.id);
    }
  } else if (entry.type === 'snapshot') {
    todos = entry.previous;
  }

  saveTodos();
  render();
  showToast(`'${entry.label}' 작업을 되돌렸습니다.`, { type: 'success' });
}

/* --------------------------------------------------------------------------
 * 9. 상태 변경 함수 (todos 수정 → saveTodos() → render())
 * ------------------------------------------------------------------------ */

/**
 * 새 할 일을 맨 앞에 추가합니다.
 * @returns {object} 추가된 항목
 */
function addTodo(text, category) {
  const todo = {
    id: generateId(),
    text,
    category: hasOwn(CATEGORY_MAP, category) ? category : DEFAULT_CATEGORY,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  todos.unshift(todo);
  newItemIds.add(todo.id);
  saveTodos();
  render();
  return todo;
}

/**
 * 항목을 삭제하고 실행 취소 기록을 남깁니다.
 * @returns {object|null} 삭제된 항목. 없으면 null
 */
function deleteTodo(id) {
  const index = todos.findIndex((t) => t.id === id);
  if (index === -1) return null;
  const [removed] = todos.splice(index, 1);
  pushUndo({ type: 'remove', label: '삭제', items: [{ todo: removed, index }] });
  saveTodos();
  render();
  return removed;
}

function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return null;
  todo.completed = !todo.completed;
  saveTodos();
  render();
  return todo;
}

/** 완료된 항목을 모두 삭제합니다(필터와 관계없이 전체 대상). 실행 취소할 수 있습니다. */
function clearCompleted() {
  const removedItems = [];
  todos.forEach((todo, index) => {
    if (todo.completed) removedItems.push({ todo, index });
  });
  if (removedItems.length === 0) return 0;

  todos = todos.filter((t) => !t.completed);
  pushUndo({ type: 'remove', label: '완료 항목 삭제', items: removedItems });
  saveTodos();
  render();
  return removedItems.length;
}

/**
 * 직접 정렬: id 항목을 targetId 항목의 앞(before) 또는 뒤(after)로 옮깁니다.
 * 필터나 검색으로 일부만 보이는 상태에서도 전체 배열 기준으로 올바르게 옮겨집니다.
 * @returns {boolean} 실제로 옮겼는지 여부
 */
function reorderTodo(id, targetId, position) {
  if (id === targetId) return false;
  const from = todos.findIndex((t) => t.id === id);
  if (from === -1) return false;

  const [item] = todos.splice(from, 1);
  let to = todos.findIndex((t) => t.id === targetId);
  if (to === -1) {
    todos.splice(from, 0, item); // 대상이 없으면 원상 복구
    return false;
  }
  if (position === 'after') to += 1;
  todos.splice(to, 0, item);

  saveTodos();
  render();
  return true;
}

/* --------------------------------------------------------------------------
 * 10. 필터링 및 정렬
 * ------------------------------------------------------------------------ */

/** 최신순 비교. createdAt이 모두 ISO 형식이라 문자열 비교로 충분하고 Date 생성보다 빠릅니다. */
function compareCreatedDesc(a, b) {
  if (a.createdAt < b.createdAt) return 1;
  if (a.createdAt > b.createdAt) return -1;
  return 0;
}

const COMPARATORS = {
  created: compareCreatedDesc,
  category: (a, b) =>
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || compareCreatedDesc(a, b),
  status: (a, b) => Number(a.completed) - Number(b.completed) || compareCreatedDesc(a, b),
};

/** 현재 필터, 검색어, 정렬을 적용한 '화면에 보일' 목록을 반환합니다(원본은 건드리지 않음). */
function getVisibleTodos() {
  const result = todos.filter(
    (t) =>
      (currentFilter === 'all' || t.category === currentFilter) &&
      (!searchQuery || toKey(t.text).includes(searchQuery))
  );
  // manual 모드는 배열 순서를 그대로 씁니다. filter가 새 배열을 만들므로 sort가 원본을 바꾸지 않습니다.
  if (currentSort !== 'manual') result.sort(COMPARATORS[currentSort]);
  return result;
}

/* --------------------------------------------------------------------------
 * 11. 렌더링
 * ------------------------------------------------------------------------ */

/** 항목 하나의 DOM 뼈대를 만듭니다. 내용은 updateTodoElement가 채웁니다. */
function createTodoElement() {
  const li = document.createElement('li');
  li.className = 'todo-item';

  // 드래그 핸들: 직접 정렬 모드에서만 보이고, 키보드 화살표로도 순서를 바꿀 수 있습니다.
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  handle.setAttribute('aria-describedby', 'reorder-help');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'todo-checkbox';

  const content = document.createElement('div');
  content.className = 'todo-content';

  const text = document.createElement('span');
  text.className = 'todo-text';

  const meta = document.createElement('div');
  meta.className = 'todo-meta';

  const tag = document.createElement('span');
  const time = document.createElement('time');
  time.className = 'created-at';

  meta.append(tag, time);
  content.append(text, meta);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'delete-btn';
  del.textContent = '×';

  li.append(handle, checkbox, content, del);
  return { li, handle, checkbox, text, tag, time, del, signature: '' };
}

/**
 * 캐시된 요소에 최신 데이터를 반영합니다.
 * 표시에 영향을 주는 값이 하나도 바뀌지 않았으면(signature 동일) 아무것도 하지 않습니다.
 * 요소를 새로 만들지 않고 고치기 때문에 체크박스의 포커스도 유지됩니다.
 */
function updateTodoElement(entry, todo, manual) {
  const timeLabel = timeAgo(todo.createdAt);
  const signature = [todo.id, todo.text, todo.completed, todo.category, todo.createdAt, timeLabel, manual].join('␟');
  if (signature === entry.signature) return;
  entry.signature = signature;

  const { li, handle, checkbox, text, tag, time, del } = entry;
  li.dataset.id = todo.id;
  li.classList.toggle('completed', todo.completed);
  li.draggable = manual;

  handle.hidden = !manual;
  handle.setAttribute('aria-label', `"${todo.text}" 순서 이동`);

  checkbox.checked = todo.completed;
  checkbox.setAttribute('aria-label', `"${todo.text}" 완료 표시`);

  text.textContent = todo.text; // textContent: XSS 방지

  tag.className = `category-tag ${todo.category}`;
  tag.textContent = CATEGORY_MAP[todo.category];

  time.dateTime = todo.createdAt;
  time.textContent = timeLabel;
  time.title = new Date(todo.createdAt).toLocaleString();

  del.setAttribute('aria-label', `"${todo.text}" 삭제`);
}

/**
 * 부모의 자식 노드를 nodes 순서와 같게 맞춥니다.
 * 이미 제자리에 있는 노드는 건드리지 않고, 순서가 다른 노드만 옮기고, 남는 노드는 제거합니다.
 * replaceChildren으로 통째로 바꾸는 것보다 DOM 변경이 훨씬 적습니다.
 */
function reconcileChildren(parent, nodes) {
  let cursor = parent.firstChild;
  for (const node of nodes) {
    if (node === cursor) {
      cursor = cursor.nextSibling;
    } else {
      parent.insertBefore(node, cursor);
    }
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
}

/** 화면 전체를 현재 상태에 맞춥니다. */
function render() {
  const manual = currentSort === 'manual';
  const visible = getVisibleTodos();
  // DOM 노드를 옮기면 브라우저에 따라 포커스가 풀릴 수 있어서 미리 기억해 둡니다.
  const previouslyFocused = document.activeElement;

  const visibleIds = new Set();
  const nodes = visible.map((todo) => {
    let entry = elementCache.get(todo.id);
    if (!entry) {
      entry = createTodoElement();
      elementCache.set(todo.id, entry);
      if (newItemIds.has(todo.id)) entry.li.classList.add('is-new');
    }
    updateTodoElement(entry, todo, manual);
    visibleIds.add(todo.id);
    return entry.li;
  });
  newItemIds.clear();

  // 화면에서 사라진 항목의 캐시는 정리합니다(메모리 누수 방지).
  for (const id of elementCache.keys()) {
    if (!visibleIds.has(id)) elementCache.delete(id);
  }

  reconcileChildren(list, nodes);

  if (
    previouslyFocused instanceof HTMLElement &&
    previouslyFocused !== document.activeElement &&
    previouslyFocused.isConnected
  ) {
    previouslyFocused.focus({ preventScroll: true });
  }

  list.classList.toggle('is-manual', manual);
  renderSummary(visible.length);
}

/** 목록 이외의 부분(빈 메시지, 카운트, 필터 버튼, 대시보드)을 갱신합니다. */
function renderSummary(visibleCount) {
  const total = todos.length;
  let completed = 0;
  let createdToday = 0;
  const todayKey = localDateKey(new Date());
  const perCategory = {};
  for (const cat of CATEGORY_ORDER) perCategory[cat] = { total: 0, done: 0 };

  // 한 번만 순회하면서 필요한 통계를 모두 계산합니다.
  for (const t of todos) {
    if (t.completed) completed++;
    if (localDateKey(new Date(t.createdAt)) === todayKey) createdToday++;
    const stat = perCategory[t.category];
    if (stat) {
      stat.total++;
      if (t.completed) stat.done++;
    }
  }
  const active = total - completed;
  const percent = calcPercent(completed, total);

  // 빈 목록 메시지: 상황마다 다른 안내를 보여 줍니다.
  emptyMessage.hidden = visibleCount > 0;
  if (visibleCount === 0) {
    if (total === 0) emptyMessage.textContent = '할 일이 없습니다. 위에서 새 할 일을 추가해 보세요.';
    else if (searchQuery) emptyMessage.textContent = `"${truncate(searchInput.value.trim())}"에 대한 검색 결과가 없습니다.`;
    else emptyMessage.textContent = `'${CATEGORY_MAP[currentFilter] ?? ''}' 카테고리에 할 일이 없습니다.`;
  }

  footer.hidden = total === 0;
  todoCount.textContent = `남은 할 일: ${active}개`;
  clearCompletedBtn.hidden = completed === 0;
  clearCompletedBtn.textContent = `완료 항목 삭제 (${completed})`;

  remainingBadge.textContent = String(active);
  remainingBadge.setAttribute('aria-label', `남은 할 일 ${active}개`);

  for (const btn of filterNav.querySelectorAll('.filter-btn')) {
    const isActive = btn.dataset.filter === currentFilter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }
  sortSelect.value = currentSort;

  // --- 대시보드 ---
  totalProgressText.textContent = `${completed}/${total} 완료 (${percent}%)`;
  totalProgressFill.style.width = `${percent}%`;
  totalProgressBar.setAttribute('aria-valuenow', String(percent));
  totalProgressBar.setAttribute('aria-valuetext', `${total}개 중 ${completed}개 완료, ${percent}퍼센트`);
  todayCount.textContent = String(createdToday);

  for (const cat of CATEGORY_ORDER) {
    const refs = categoryStatRefs[cat];
    if (!refs) continue;
    const { total: catTotal, done } = perCategory[cat];
    const catPercent = calcPercent(done, catTotal);
    refs.value.textContent = `${done}/${catTotal}`;
    refs.fill.style.width = `${catPercent}%`;
    refs.bar.setAttribute('aria-valuenow', String(catPercent));
    refs.bar.setAttribute('aria-valuetext', `${catTotal}개 중 ${done}개 완료`);
  }

  renderCheer(percent, total, completed);
}

/**
 * 완료율(%)을 계산합니다.
 * 반올림 때문에 199/200이 '100%'로 보이지 않도록 전부 끝났을 때만 100을 반환합니다.
 */
function calcPercent(done, total) {
  if (total === 0) return 0;
  if (done >= total) return 100;
  return Math.min(99, Math.round((done / total) * 100));
}

/** 완료율에 따라 응원 메시지를 바꿉니다. 처음으로 100%가 되면 스크린 리더에도 축하를 알립니다. */
function renderCheer(percent, total, completed) {
  let message;
  if (total === 0) message = '첫 할 일을 추가해 보세요! ✨';
  else if (completed === 0) message = '시작이 반이에요. 하나만 끝내 볼까요? 💪';
  else if (percent < 30) message = '좋은 출발이에요! 이 흐름 그대로 가 봐요 🚶';
  else if (percent < 60) message = '절반을 향해 가는 중! 잘하고 있어요 👍';
  else if (percent < 100) message = '거의 다 왔어요! 조금만 더 힘내요 🔥';
  else message = '모든 할 일을 끝냈어요! 정말 멋져요 🎉';

  if (cheerMessage.textContent !== message) cheerMessage.textContent = message;
  cheerMessage.dataset.level = percent === 100 && total > 0 ? 'done' : '';

  if (lastPercent !== null && lastPercent < 100 && percent === 100 && total > 0) {
    announce('모든 할 일을 완료했습니다! 축하합니다.');
  }
  lastPercent = percent;
}

/** 대시보드의 카테고리별 진행률 막대를 한 번만 만듭니다. */
function buildCategoryStats() {
  const frag = document.createDocumentFragment();
  for (const cat of CATEGORY_ORDER) {
    const wrap = document.createElement('div');
    wrap.className = 'cat-stat';

    const info = document.createElement('div');
    info.className = 'cat-stat-info';
    const name = document.createElement('span');
    name.textContent = CATEGORY_MAP[cat];
    const value = document.createElement('span');
    value.textContent = '0/0';
    info.append(name, value);

    const bar = document.createElement('div');
    bar.className = 'cat-progress-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', `${CATEGORY_MAP[cat]} 진행률`);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', '0');

    const fill = document.createElement('div');
    fill.className = 'cat-progress-fill';
    fill.style.background = CATEGORY_COLORS[cat];
    bar.append(fill);

    wrap.append(info, bar);
    frag.append(wrap);
    categoryStatRefs[cat] = { value, bar, fill };
  }
  categoryProgressList.replaceChildren(frag);
}

/** 기존 항목을 잠깐 강조하고 화면에 보이게 스크롤합니다(중복 경고 때 사용). */
function highlightTodo(id) {
  const entry = elementCache.get(id);
  if (!entry) return;
  entry.li.classList.remove('flash');
  void entry.li.offsetWidth; // 리플로우를 강제해야 애니메이션이 처음부터 다시 재생됩니다.
  entry.li.classList.add('flash');
  entry.li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* --------------------------------------------------------------------------
 * 12. 오늘의 격언
 * ------------------------------------------------------------------------ */

let quoteIndex = -1;
let quoteDay = '';

function showQuote(index) {
  const quote = QUOTES[index];
  if (!quote) return;
  quoteIndex = index;
  quoteText.textContent = quote.text;
  quoteAuthor.textContent = `— ${quote.author}`;
}

/** 날짜를 시드로 써서 하루 동안은 같은 격언이 나오게 합니다. */
function showDailyQuote() {
  quoteDay = localDateKey(new Date());
  showQuote(hashString(quoteDay) % QUOTES.length);
}

/** 지금과 다른 격언을 무작위로 보여 줍니다. */
function showRandomQuote() {
  if (QUOTES.length < 2) return;
  let next;
  do {
    next = Math.floor(Math.random() * QUOTES.length);
  } while (next === quoteIndex);
  showQuote(next);
}

/* --------------------------------------------------------------------------
 * 13. 테마
 * ------------------------------------------------------------------------ */

function applyTheme(theme) {
  currentTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', currentTheme);
  const isDark = currentTheme === 'dark';
  themeToggle.setAttribute('aria-pressed', String(isDark));
  themeToggle.setAttribute('aria-label', isDark ? '라이트 모드로 전환' : '다크 모드로 전환');
}

/** 저장된 테마를 쓰고, 없으면 운영체제 설정(prefers-color-scheme)을 따릅니다. */
function initTheme() {
  const saved = storage.get(THEME_KEY);
  if (saved === 'light' || saved === 'dark') {
    applyTheme(saved);
    return;
  }
  const prefersDark = typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(prefersDark ? 'dark' : 'light');
}

function toggleTheme() {
  applyTheme(currentTheme === 'light' ? 'dark' : 'light');
  storage.set(THEME_KEY, currentTheme);
}

/* --------------------------------------------------------------------------
 * 14. 내보내기 / 가져오기
 * ------------------------------------------------------------------------ */

/** 내보내기 파일 내용. 형식 식별자와 버전이 있어서 나중에 구조가 바뀌어도 구분할 수 있습니다. */
function buildExportPayload() {
  return {
    app: EXPORT_APP_ID,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    count: todos.length,
    todos,
  };
}

/**
 * 데이터를 JSON 파일로 내려받게 합니다.
 * @returns {boolean} 성공 여부
 */
function downloadJson(data, filename) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    // 다운로드가 시작될 시간을 준 뒤 메모리를 해제합니다.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (err) {
    console.error('파일 생성 실패:', err);
    return false;
  }
}

function exportTodos() {
  flushSave();
  if (todos.length === 0) {
    showToast('내보낼 할 일이 없습니다.');
    return;
  }
  const ok = downloadJson(buildExportPayload(), `my-tasks-${fileTimestamp()}.json`);
  if (ok) showToast(`${todos.length}개 항목을 내보냈습니다.`, { type: 'success' });
  else showToast('파일을 만들지 못했습니다. 브라우저가 다운로드를 막고 있는지 확인해 주세요.', { type: 'error' });
}

/**
 * 선택한 파일을 읽고 검증합니다. 문제가 없으면 확인 대화상자를 엽니다.
 * 다음 경우를 처리합니다: 빈 파일, 너무 큰 파일, 읽기 실패, JSON 문법 오류,
 * 다른 앱의 파일, 유효한 항목 없음, 항목 수 초과
 * @param {File|undefined} file
 */
async function handleImportFile(file) {
  if (!file) return;

  if (file.size === 0) {
    showToast('빈 파일입니다.', { type: 'error' });
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    showToast('파일이 너무 큽니다. (최대 5MB)', { type: 'error' });
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch (err) {
    console.error('파일 읽기 실패:', err);
    showToast('파일을 읽지 못했습니다.', { type: 'error' });
    return;
  }

  let parsed;
  try {
    // 일부 편집기가 붙이는 UTF-8 BOM을 제거합니다.
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    console.error('JSON 파싱 실패:', err);
    showToast('올바른 JSON 파일이 아닙니다.', { type: 'error' });
    return;
  }

  // 우리 앱의 내보내기 형식({ app, version, todos })과 순수 배열을 모두 받습니다.
  let rawList = null;
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.todos)) {
    if (typeof parsed.version === 'number' && parsed.version > EXPORT_VERSION) {
      console.warn(`더 최신 버전(${parsed.version})의 파일입니다. 아는 필드만 가져옵니다.`);
    }
    rawList = parsed.todos;
  }

  if (!rawList) {
    showToast('파일에서 할 일 목록을 찾을 수 없습니다.', { type: 'error' });
    return;
  }
  if (rawList.length > MAX_IMPORT_ITEMS) {
    showToast(`항목이 너무 많습니다. (최대 ${MAX_IMPORT_ITEMS.toLocaleString()}개)`, { type: 'error' });
    return;
  }

  const { todos: imported, skipped } = normalizeTodoList(rawList);
  if (imported.length === 0) {
    showToast('가져올 수 있는 올바른 항목이 없습니다.', { type: 'error' });
    return;
  }

  openImportDialog(imported, skipped);
}

/** 가져오기 확인 대화상자를 엽니다. 현재 데이터 백업 여부를 여기서 확인받습니다. */
function openImportDialog(imported, skipped) {
  pendingImport = imported;

  const skippedText = skipped > 0 ? ` (잘못된 항목 ${skipped}개는 제외)` : '';
  importSummary.textContent =
    `파일에서 ${imported.length}개 항목을 찾았습니다${skippedText}. 현재 목록에는 ${todos.length}개 항목이 있습니다.`;

  // 현재 데이터가 없으면 백업할 것도 없으므로 체크박스를 끕니다.
  const hasData = todos.length > 0;
  importBackup.checked = hasData;
  importBackup.disabled = !hasData;
  const mergeRadio = importDialog.querySelector('input[name="import-mode"][value="merge"]');
  if (mergeRadio) mergeRadio.checked = true; // 매번 더 안전한 '합치기'로 시작합니다.
  updateImportWarning();

  if (typeof importDialog.showModal === 'function') {
    importDialog.returnValue = '';
    importDialog.showModal();
    return;
  }

  // <dialog>를 지원하지 않는 구형 브라우저: confirm으로 대신합니다(합치기만 가능).
  const wantBackup = hasData && window.confirm('가져오기 전에 현재 데이터를 백업 파일로 저장할까요?');
  if (window.confirm(`${imported.length}개 항목을 현재 목록에 합칠까요?`)) {
    applyImport(imported, 'merge', wantBackup);
  } else {
    showToast('가져오기를 취소했습니다.');
  }
  pendingImport = null;
}

/** '덮어쓰기'를 선택했는데 백업을 끈 경우에만 경고를 표시합니다. */
function updateImportWarning() {
  const mode = importDialog.querySelector('input[name="import-mode"]:checked')?.value;
  importWarning.hidden = !(mode === 'replace' && todos.length > 0 && !importBackup.checked);
}

/**
 * 가져오기를 실제로 적용합니다.
 * @param {object[]} imported 정규화된 항목들
 * @param {'merge'|'replace'} mode
 * @param {boolean} backup 적용 전에 현재 데이터를 파일로 받을지 여부
 */
function applyImport(imported, mode, backup) {
  flushSave();

  if (backup && todos.length > 0) {
    const ok = downloadJson(buildExportPayload(), `my-tasks-backup-${fileTimestamp()}.json`);
    if (!ok && !window.confirm('백업 파일을 만들지 못했습니다. 백업 없이 계속 가져올까요?')) {
      showToast('가져오기를 취소했습니다.');
      return;
    }
  }

  // 실행 취소용 스냅샷. 배열만 복사합니다(가져오기 과정에서 기존 객체는 수정하지 않음).
  const previous = todos.slice();
  let added = 0;
  let skipped = 0;

  if (mode === 'replace') {
    todos = imported;
    added = imported.length;
  } else {
    const byId = new Map(todos.map((t) => [t.id, t]));
    const toAdd = [];
    for (const item of imported) {
      const existing = byId.get(item.id);
      if (existing) {
        // 같은 id이고 내용도 같으면 이미 있는 항목이므로 건너뜁니다.
        if (existing.text === item.text) {
          skipped++;
          continue;
        }
        // id만 겹치고 내용이 다르면 새 id를 줘서 별개 항목으로 추가합니다.
        item.id = generateId();
      }
      byId.set(item.id, item);
      toAdd.push(item);
    }
    todos = [...todos, ...toAdd];
    added = toAdd.length;
  }

  pushUndo({ type: 'snapshot', label: '가져오기', previous });
  saveTodos();
  render();

  const message = mode === 'replace'
    ? `목록을 가져온 ${added}개 항목으로 바꿨습니다.`
    : `${added}개 항목을 추가했습니다${skipped ? ` (이미 있는 ${skipped}개 제외)` : ''}.`;
  showToast(message, { undo: true, type: 'success' });
}

/* --------------------------------------------------------------------------
 * 15. 입력 폼
 * ------------------------------------------------------------------------ */

/**
 * 입력창 아래 메시지를 설정합니다.
 * @param {string} message
 * @param {''|'error'|'warning'} type
 */
function setInputMessage(message, type = '') {
  inputMessage.textContent = message;
  inputMessage.dataset.type = type;
  input.setAttribute('aria-invalid', type === 'error' ? 'true' : 'false');
}

/** 같은 텍스트(대소문자, 공백 차이 무시)의 기존 항목을 찾습니다. */
function findDuplicate(key) {
  return todos.find((t) => toKey(t.text) === key) || null;
}

/* ----- 자동 카테고리 분류 (입력 폼) ----- */

/**
 * 카테고리 select 아래의 분류 안내 문구를 설정합니다.
 * @param {string} message
 * @param {''|'auto'|'suggest'|'ambiguous'} type
 */
function setCategoryHint(message, type = '') {
  if (categoryHint.textContent === message && categoryHint.dataset.type === type) return; // 같은 문구 반복 낭독 방지
  categoryHint.textContent = message;
  categoryHint.dataset.type = type;
}

/** select 값을 바꾸고, 실제로 바뀌었으면 잠깐 강조해서 사용자가 변화를 알아차리게 합니다. */
function setCategoryValue(category) {
  if (!hasOwn(CATEGORY_MAP, category) || categorySelect.value === category) return;
  categorySelect.value = category;
  categorySelect.classList.remove('auto-applied');
  void categorySelect.offsetWidth; // 애니메이션 재시작
  categorySelect.classList.add('auto-applied');
}

/** 키워드 목록을 안내 문구용으로 만듭니다. 너무 길지 않게 최대 3개까지만 씁니다. */
function formatKeywords(keywords) {
  const shown = keywords.slice(0, 3).map((k) => `'${k}'`).join(', ');
  return keywords.length > 3 ? `${shown} 외 ${keywords.length - 3}개` : shown;
}

/**
 * 현재 입력 내용으로 카테고리를 자동 분류해 select에 반영합니다.
 * - 사용자가 직접 고른 경우: 값을 바꾸지 않고, 다른 추천이 있으면 안내만 합니다.
 * - 키워드 없음: 기본(마지막으로 직접 고른) 카테고리로 되돌립니다.
 * - 동점: 바꾸지 않고, 직접 확인하라고 안내합니다.
 */
function applyAutoCategory() {
  if (!autoCategoryEnabled) return;

  const text = sanitizeText(input.value);
  const result = text ? classifyText(text) : null;

  if (categoryManuallySet) {
    if (result && result.category && result.category !== categorySelect.value) {
      setCategoryHint(
        `직접 선택한 '${CATEGORY_MAP[categorySelect.value]}'을(를) 사용합니다 · 추천: ${CATEGORY_MAP[result.category]} (${formatKeywords(result.keywords)})`,
        'suggest'
      );
    } else {
      setCategoryHint('');
    }
    return;
  }

  if (!result) {
    setCategoryValue(baseCategory);
    setCategoryHint('');
    return;
  }

  if (!result.category) {
    setCategoryValue(baseCategory);
    const names = result.ambiguous.map((c) => CATEGORY_MAP[c]).join('·');
    setCategoryHint(`여러 카테고리(${names})의 키워드가 섞여 있어요. 카테고리를 직접 확인해 주세요.`, 'ambiguous');
    return;
  }

  setCategoryValue(result.category);
  setCategoryHint(`자동 분류: ${CATEGORY_MAP[result.category]} · 키워드 ${formatKeywords(result.keywords)}`, 'auto');
}

/** 타이핑할 때마다 분류하지 않고, 입력이 잠깐 멈추면 한 번만 분류합니다. */
const scheduleAutoCategory = debounce(applyAutoCategory, CLASSIFY_DEBOUNCE_MS);

/** 할 일을 하나 추가한 뒤 다음 입력을 위해 분류 상태를 초기화합니다. */
function resetAutoCategory() {
  scheduleAutoCategory.cancel();
  categoryManuallySet = false;
  if (autoCategoryEnabled) setCategoryValue(baseCategory);
  setCategoryHint('');
}

// 사용자가 카테고리를 직접 고르면 그 선택을 존중합니다(이번 할 일과, 이후의 기본값 모두).
categorySelect.addEventListener('change', () => {
  categoryManuallySet = true;
  baseCategory = categorySelect.value;
  scheduleAutoCategory.cancel();
  applyAutoCategory(); // 추천과 다르면 안내만 갱신
});

autoCategoryToggle.addEventListener('change', () => {
  autoCategoryEnabled = autoCategoryToggle.checked;
  storage.set(AUTO_CATEGORY_KEY, autoCategoryEnabled ? '1' : '0');
  if (autoCategoryEnabled) {
    applyAutoCategory(); // 이미 입력된 내용이 있으면 바로 분류
    announce('키워드 자동 분류를 켰습니다.');
  } else {
    scheduleAutoCategory.cancel();
    // 자동으로 바뀐 값이 남아 있으면 혼란스러우므로 기본 카테고리로 되돌립니다.
    if (!categoryManuallySet) setCategoryValue(baseCategory);
    setCategoryHint('');
    announce('키워드 자동 분류를 껐습니다.');
  }
});

categorySelect.addEventListener('animationend', () => categorySelect.classList.remove('auto-applied'));

/** 검색을 초기화합니다. render 여부는 호출하는 쪽에서 정합니다. */
function clearSearch() {
  applySearch.cancel();
  searchInput.value = '';
  searchQuery = '';
}

form.addEventListener('submit', (e) => {
  e.preventDefault();

  // 빠르게 입력하고 바로 Enter를 누르면 분류 디바운스가 아직 대기 중일 수 있으므로,
  // 카테고리 값을 읽기 전에 즉시 분류를 끝냅니다.
  scheduleAutoCategory.flush();

  const text = sanitizeText(input.value);
  if (!text) {
    setInputMessage('할 일 내용을 입력해 주세요.', 'error');
    input.value = '';
    input.focus();
    return;
  }

  // 중복 확인: 처음에는 경고만 하고, 같은 내용으로 한 번 더 제출하면 추가합니다.
  const key = toKey(text);
  const duplicate = findDuplicate(key);
  if (duplicate && duplicateConfirmKey !== key) {
    duplicateConfirmKey = key;
    const state = duplicate.completed ? ', 완료됨' : '';
    setInputMessage(
      `이미 같은 할 일이 있습니다: "${truncate(duplicate.text)}" (${CATEGORY_MAP[duplicate.category]}${state}). 그래도 추가하려면 다시 추가를 누르세요.`,
      'warning'
    );
    highlightTodo(duplicate.id);
    input.focus();
    return;
  }
  duplicateConfirmKey = null;

  // 검색어 때문에 방금 추가한 항목이 안 보이면 혼란스러우므로 검색을 해제합니다.
  if (searchQuery && !key.includes(searchQuery)) clearSearch();

  const todo = addTodo(text, categorySelect.value);
  input.value = '';
  setInputMessage('');
  resetAutoCategory();
  input.focus();

  // 현재 카테고리 필터 때문에 새 항목이 보이지 않으면 알려 줍니다.
  if (currentFilter !== 'all' && currentFilter !== todo.category) {
    showToast(`'${CATEGORY_MAP[todo.category]}'에 추가했습니다. 현재 필터에서는 보이지 않습니다.`);
  } else {
    announce(`"${truncate(todo.text)}" 추가됨`);
  }
});

// 내용을 고치면 중복 확인 상태와 오류 메시지를 초기화합니다.
input.addEventListener('input', () => {
  duplicateConfirmKey = null;
  if (inputMessage.textContent) setInputMessage('');
  if (autoCategoryEnabled) scheduleAutoCategory();
});

/* --------------------------------------------------------------------------
 * 16. 목록 이벤트 (모두 #todo-list 위임 리스너)
 * ------------------------------------------------------------------------ */

/** 이벤트 대상에서 가장 가까운 항목(li)을 찾습니다. 텍스트 노드가 대상이어도 처리합니다. */
function itemFromEvent(e) {
  const el = e.target instanceof Element ? e.target : e.target?.parentElement;
  return el ? el.closest('.todo-item') : null;
}

// 체크박스: click 대신 change를 써서 마우스와 키보드(Space)를 모두 처리합니다.
list.addEventListener('change', (e) => {
  if (!e.target.matches('.todo-checkbox')) return;
  const item = itemFromEvent(e);
  if (!item) return;
  const todo = toggleTodo(item.dataset.id);
  if (todo) announce(`"${truncate(todo.text)}" ${todo.completed ? '완료' : '미완료'}로 표시`);
});

// 삭제 버튼
list.addEventListener('click', (e) => {
  if (!e.target.closest('.delete-btn')) return;
  const item = itemFromEvent(e);
  if (item) handleDelete(item.dataset.id);
});

/**
 * 삭제 후 포커스 관리: 사라진 버튼에 포커스가 남지 않도록
 * 다음 항목(없으면 이전 항목, 그것도 없으면 입력창)으로 포커스를 옮깁니다.
 */
function handleDelete(id) {
  const visibleIds = Array.from(list.children, (li) => li.dataset.id);
  const index = visibleIds.indexOf(id);

  const removed = deleteTodo(id);
  if (!removed) return;

  showToast(`"${truncate(removed.text)}" 삭제됨`, { undo: true });

  const nextId = visibleIds[index + 1] ?? visibleIds[index - 1];
  const nextEntry = nextId ? elementCache.get(nextId) : null;
  (nextEntry ? nextEntry.checkbox : input).focus();
}

// 키보드로 순서 바꾸기: 드래그 핸들에 포커스한 상태에서 ↑/↓
list.addEventListener('keydown', (e) => {
  if (!e.target.matches('.drag-handle')) return;
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault(); // 페이지 스크롤 방지
  const item = itemFromEvent(e);
  if (item) moveByKeyboard(item.dataset.id, e.key === 'ArrowUp' ? -1 : 1);
});

function moveByKeyboard(id, direction) {
  const ids = Array.from(list.children, (li) => li.dataset.id);
  const index = ids.indexOf(id);
  const targetIndex = index + direction;
  if (index === -1) return;
  if (targetIndex < 0 || targetIndex >= ids.length) {
    announce(direction < 0 ? '이미 맨 위입니다.' : '이미 맨 아래입니다.');
    return;
  }
  if (reorderTodo(id, ids[targetIndex], direction < 0 ? 'before' : 'after')) {
    elementCache.get(id)?.handle.focus();
    announce(`${ids.length}개 중 ${targetIndex + 1}번째로 이동했습니다.`);
  }
}

// ----- 드래그 앤 드롭 (HTML5 네이티브, 직접 정렬 모드에서만) -----

/** 드롭 위치 표시선을 갱신합니다. 같은 위치면 DOM을 건드리지 않습니다(dragover는 매우 자주 발생). */
function setDropIndicator(li, position) {
  if (drag.targetLi === li && drag.position === position) return;
  if (drag.targetLi) drag.targetLi.classList.remove('drop-before', 'drop-after');
  drag.targetLi = li;
  drag.position = position;
  if (li) li.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
}

function endDrag() {
  setDropIndicator(null, null);
  list.querySelector('.dragging')?.classList.remove('dragging');
  drag.id = null;
}

list.addEventListener('dragstart', (e) => {
  const li = itemFromEvent(e);
  if (currentSort !== 'manual' || !li) {
    e.preventDefault();
    return;
  }
  drag.id = li.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  try {
    e.dataTransfer.setData('text/plain', drag.id); // Firefox는 데이터가 있어야 드래그가 시작됩니다.
  } catch {
    /* 일부 환경에서 setData가 실패해도 드래그 자체는 계속합니다. */
  }
  // 드래그 미리보기 이미지가 캡처된 뒤에 반투명 스타일을 적용합니다.
  requestAnimationFrame(() => li.classList.add('dragging'));
});

list.addEventListener('dragover', (e) => {
  if (!drag.id) return; // 외부에서 끌어온 텍스트 등은 무시합니다.
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  let li = itemFromEvent(e);
  let position;
  if (li) {
    const rect = li.getBoundingClientRect();
    position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  } else {
    // 항목 사이의 빈 공간이나 목록 아래쪽: 마지막 항목 뒤로 놓습니다.
    li = list.lastElementChild;
    position = 'after';
  }
  if (!li || li.dataset.id === drag.id) {
    setDropIndicator(null, null);
    return;
  }
  setDropIndicator(li, position);
});

list.addEventListener('drop', (e) => {
  if (!drag.id) return;
  e.preventDefault();
  const { id, targetLi, position } = drag;
  endDrag();
  if (targetLi && reorderTodo(id, targetLi.dataset.id, position)) {
    announce('순서를 변경했습니다.');
  }
});

list.addEventListener('dragend', endDrag);

// 등장/강조 애니메이션이 끝나면 클래스를 지웁니다. 노드가 옮겨질 때 다시 재생되지 않게 하려는 것입니다.
list.addEventListener('animationend', (e) => {
  if (e.target.classList?.contains('todo-item')) e.target.classList.remove('is-new', 'flash');
});

/* --------------------------------------------------------------------------
 * 17. 필터 / 정렬 / 검색 / 기타 컨트롤
 * ------------------------------------------------------------------------ */

filterNav.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn || !VALID_FILTERS.includes(btn.dataset.filter)) return;
  if (btn.dataset.filter === currentFilter) return;
  currentFilter = btn.dataset.filter;
  storage.set(FILTER_KEY, currentFilter);
  render();
  announce(`${btn.textContent.trim()} 필터: ${list.children.length}개 표시`);
});

sortSelect.addEventListener('change', () => {
  const value = sortSelect.value;
  if (!hasOwn(SORT_LABELS, value)) return;
  currentSort = value;
  storage.set(SORT_KEY, currentSort);
  render();
  announce(
    value === 'manual'
      ? '직접 정렬 모드입니다. 항목을 드래그하거나, 핸들 버튼에서 위아래 화살표 키로 순서를 바꿀 수 있습니다.'
      : `${SORT_LABELS[value]}으로 정렬했습니다.`
  );
});

/** 검색(디바운스): 입력을 멈춘 뒤 한 번만 렌더링해서 타이핑이 끊기지 않게 합니다. */
const applySearch = debounce(() => {
  const next = toKey(sanitizeText(searchInput.value));
  if (next === searchQuery) return;
  searchQuery = next;
  render();
  announce(searchQuery ? `검색 결과 ${list.children.length}개` : '검색어를 지웠습니다.');
}, SEARCH_DEBOUNCE_MS);

searchInput.addEventListener('input', applySearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && searchInput.value) {
    e.preventDefault();
    clearSearch();
    render();
    announce('검색어를 지웠습니다.');
  }
});

clearCompletedBtn.addEventListener('click', () => {
  const count = clearCompleted();
  if (count > 0) {
    showToast(`완료 항목 ${count}개를 삭제했습니다.`, { undo: true });
    input.focus(); // 버튼이 사라지므로 포커스를 입력창으로 옮깁니다.
  }
});

themeToggle.addEventListener('click', toggleTheme);
quoteNextBtn.addEventListener('click', showRandomQuote);

exportBtn.addEventListener('click', exportTodos);
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files && importFile.files[0];
  try {
    await handleImportFile(file);
  } finally {
    // 같은 파일을 다시 선택해도 change 이벤트가 나도록 값을 비웁니다.
    importFile.value = '';
  }
});

importDialog.addEventListener('change', updateImportWarning);

/**
 * 가져오기 대화상자의 결과를 처리합니다. pendingImport를 비우므로 여러 번 불려도 한 번만 동작합니다.
 * @param {boolean} confirmed '가져오기' 버튼을 눌렀는지 여부
 */
function finishImportDialog(confirmed) {
  const imported = pendingImport;
  pendingImport = null;
  if (!imported) return;

  // 대화상자가 닫힌 뒤 포커스를 '가져오기' 버튼으로 돌려줍니다.
  importBtn.focus();

  if (confirmed) {
    const mode = importDialog.querySelector('input[name="import-mode"]:checked')?.value === 'replace'
      ? 'replace'
      : 'merge';
    applyImport(imported, mode, importBackup.checked);
  } else {
    announce('가져오기를 취소했습니다.');
  }
}

// 버튼으로 닫을 때: submit 이벤트는 동기적으로 발생하므로 여기서 바로 처리합니다.
// ('close' 이벤트는 비동기라 환경에 따라 늦게 오거나 오지 않을 수 있어 여기에 의존하지 않습니다.)
// e.submitter가 없는 경우(일부 구형 브라우저에서 Enter로 제출)는 안전하게 취소로 처리합니다.
importDialog.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const confirmed = e.submitter?.value === 'confirm';
  importDialog.close(confirmed ? 'confirm' : 'cancel');
  finishImportDialog(confirmed);
});

// Esc 키 등 버튼 없이 닫혔을 때: 아직 처리되지 않은 가져오기가 있으면 취소로 처리합니다.
importDialog.addEventListener('close', () => finishImportDialog(false));

// 토스트
toastUndo.addEventListener('click', () => {
  hideToast();
  undo();
});
toastClose.addEventListener('click', hideToast);
toast.addEventListener('mouseenter', pauseToastTimer);
toast.addEventListener('mouseleave', () => { if (!toast.hidden) startToastTimer(); });
toast.addEventListener('focusin', pauseToastTimer);
toast.addEventListener('focusout', () => { if (!toast.hidden) startToastTimer(); });

/* --------------------------------------------------------------------------
 * 18. 전역 단축키
 *   /           : 검색창으로 이동
 *   Ctrl/⌘ + Z  : 마지막 삭제/가져오기 실행 취소 (입력 중일 때는 브라우저 기본 동작 유지)
 *   Esc         : 토스트 닫기
 * ------------------------------------------------------------------------ */
document.addEventListener('keydown', (e) => {
  if (importDialog.open) return; // 모달이 열려 있으면 대화상자에 맡깁니다.
  const typing = isEditable(document.activeElement);

  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if (
    (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' &&
    // 입력 중이면 브라우저의 텍스트 실행 취소를 우선합니다.
    // 단, 입력창이 비어 있으면 되돌릴 텍스트가 없으므로 앱의 실행 취소를 씁니다.
    // (삭제 후 포커스가 입력창으로 가도 바로 Ctrl+Z가 동작하도록)
    (!typing || (document.activeElement instanceof HTMLInputElement && document.activeElement.value === ''))
  ) {
    e.preventDefault();
    hideToast();
    undo();
  } else if (e.key === 'Escape' && !toast.hidden && !typing) {
    hideToast();
  }
});

/* --------------------------------------------------------------------------
 * 19. 생명주기: 저장 flush, 탭 간 동기화, 주기적 갱신, 전역 에러
 * ------------------------------------------------------------------------ */

// 페이지를 떠나거나 백그라운드로 갈 때 예약된 저장을 바로 실행합니다(디바운스 중 데이터 손실 방지).
window.addEventListener('pagehide', flushSave);
window.addEventListener('beforeunload', flushSave);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushSave();
  } else {
    // 다시 돌아왔을 때 날짜가 바뀌었으면 격언을 바꾸고, 상대 시간도 갱신합니다.
    if (localDateKey(new Date()) !== quoteDay) showDailyQuote();
    render();
  }
});

// 다른 탭에서 데이터를 바꾸면 이 탭에도 반영합니다.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY && e.key !== null) return; // null은 localStorage.clear()
  // 이 탭에 아직 저장하지 않은 변경이 있으면 이 탭의 내용을 우선합니다.
  if (scheduleWrite.pending()) return;

  const { todos: next, error } = parseStoredTodos(e.key === null ? null : e.newValue);
  if (error) {
    console.warn('다른 탭의 데이터가 올바르지 않아 무시합니다:', error);
    return;
  }
  todos = next;
  undoStack = []; // 다른 탭 기준으로 바뀐 데이터에 예전 실행 취소를 적용하면 꼬이므로 비웁니다.
  render();
  showToast('다른 탭에서 바뀐 내용을 반영했습니다.');
});

// 'n분 전' 표시를 1분마다 갱신합니다. 탭이 숨겨져 있으면 건너뜁니다.
// signature 캐시 덕분에 시간 표시가 실제로 바뀐 항목만 DOM이 갱신됩니다.
setInterval(() => {
  if (!document.hidden) render();
}, TIME_REFRESH_MS);

// 예상하지 못한 오류가 나도 사용자가 알 수 있게 합니다(앱은 계속 동작).
window.addEventListener('error', (e) => {
  console.error('예기치 못한 오류:', e.error || e.message);
  showToast('예기치 못한 오류가 발생했습니다. 문제가 계속되면 새로고침해 주세요.', { type: 'error' });
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('처리되지 않은 Promise 오류:', e.reason);
  showToast('작업 중 오류가 발생했습니다.', { type: 'error' });
});

/* --------------------------------------------------------------------------
 * 20. 초기화
 * ------------------------------------------------------------------------ */

function init() {
  initTheme();
  autoCategoryToggle.checked = autoCategoryEnabled;
  buildCategoryStats();
  showDailyQuote();

  // 이번 버전을 처음 실행할 때 한 번만, 예전 데이터(오래된 순으로 저장됨)를
  // 최신순으로 바꿔 둡니다. 그래야 '직접 정렬' 모드의 시작 순서가 자연스럽습니다.
  if (storage.get(SORT_KEY) === null) {
    if (todos.length > 1) {
      todos.sort(compareCreatedDesc);
      saveTodos();
    }
    storage.set(SORT_KEY, currentSort);
  }

  render();

  if (startupNotice) showToast(startupNotice, { type: 'error' });
}

init();
