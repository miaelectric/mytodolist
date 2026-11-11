# TRD: My Tasks 기술 요구사항 및 설계

| 항목 | 내용 |
|---|---|
| 문서 종류 | 기술 요구사항/설계 문서(Technical Requirements Document) |
| 대상 코드 | `index.html`, `script.js`, `style.css` (루트, 단일 버전) |
| 작성일 | 2026-11-11 |
| 관련 문서 | [PRD.md](./PRD.md), [TASK.md](./TASK.md) |

---

## 1. 기술 스택과 제약

| 항목 | 결정 | 이유 |
|---|---|---|
| 언어 | 바닐라 HTML / CSS / JavaScript(ES2020 수준) | 빌드 없이 파일을 바로 열 수 있게 |
| 프레임워크, 빌드, 패키지 | 없음 | 프로젝트 원칙(CLAUDE.md) |
| 저장소 | `localStorage` | 서버 없이 브라우저에 저장 |
| 실행 | `index.html`을 브라우저에서 직접 열기(`file://`) | |
| 개발 환경 | Windows. Node.js 없음 | `node --check`를 쓸 수 없어 헤드리스 Edge로 검증 |
| 지원 브라우저 | 최신 Chrome, Edge, Firefox, Safari | `<dialog>`, `ResizeObserver`, `content-visibility`(없으면 무시됨) |

호환성을 위한 결정:
- `Object.hasOwn`과 `||=`처럼 최근에 추가된 문법은 쓰지 않습니다. `crypto.randomUUID`가 없으면 대체 id 생성 방식을 씁니다.

---

## 2. 파일 구조와 책임

```
toodlist/
├─ index.html   마크업 + 레이아웃 보조 인라인 스크립트(고정 영역 높이 측정)
├─ script.js    상태, 렌더링, 이벤트, 저장, 가져오기/내보내기, 자동 분류 (번호 붙은 20개 섹션)
├─ style.css    공통 컴포넌트 스타일(앞부분) + 반응형 레이아웃(뒷부분 "데스크톱(웹) 레이아웃" 섹션)
├─ CLAUDE.md    개발 지침
└─ docs/        PRD / TRD / TASK
```

### 2.1 `index.html`
- 레이아웃 골격은 `.app-shell` 안의 세 블록입니다.
  - `aside.sidebar`: 앱 이름과 남은 개수 배지, 테마, 검색, 카테고리 필터, 정렬, 자동 분류 토글, 데이터(내보내기/가져오기), 단축키 안내
  - `main.main`: `.main-top`(고정 입력 폼: 카테고리 select + 입력 + 추가 버튼 + 분류 안내 + 경고 문구), 목록, 푸터
  - `aside.insights`: 오늘의 격언, 진행 현황
- 그 밖의 요소:
  - 토스트(`#toast`)
  - 스크린 리더 라이브 영역(`#sr-status` polite, `#sr-alert` assertive)
  - 가져오기 확인 대화상자(`dialog#import-dialog`)
- **id 계약**: `script.js`는 요소를 `$()`(id로 찾고 없으면 예외)로만 가져옵니다. 배치는 자유롭게 바꿔도 되지만 id는 지켜야 합니다.
- **인라인 보조 스크립트**(앱 로직 없음, `script.js` 뒤에 로드):
  - `.main-top`의 실제 높이를 CSS 변수 `--sticky-h`에 넣습니다. 고정되지 않는 폭에서는 0입니다. ResizeObserver와 resize 이벤트로 계속 갱신합니다.
  - 목록의 `animationstart`(이름이 `flash`일 때)에서 높이를 다시 재고 `scrollIntoView`를 한 번 더 호출합니다. 중복 경고 문구가 나타나 고정 영역이 커지기 **전에** 스크롤 목표가 계산되는 문제를 바로잡기 위해서입니다.

### 2.2 `script.js` 섹션 구성
| # | 섹션 | 주요 식별자 |
|---|---|---|
| 1 | 상수 | `STORAGE_KEY` 등 키, 한도값, `CATEGORY_MAP/ORDER/COLORS`, `SORT_LABELS`, `QUOTES`, `CATEGORY_KEYWORDS` |
| 2 | DOM 참조 | `$()` |
| 3 | 범용 유틸 | `debounce`, `storage`, `generateId`, `sanitizeText`, `toKey`, `truncate`, `localDateKey`, `fileTimestamp`, `hashString`, `timeAgo`, `isEditable` |
| 4-0 | 자동 분류 | `escapeRegExp`, `buildCategoryRules`, `CATEGORY_RULES`, `classifyText` |
| 4 | 검증·정규화 | `normalizeTodo`, `normalizeTodoList`, `parseStoredTodos` |
| 5 | 저장·불러오기 | `loadTodos`, `writeTodosNow`, `scheduleWrite`, `saveTodos`, `flushSave` |
| 6 | 앱 상태 | `todos`, `currentFilter`, `currentSort`, `searchQuery`, `undoStack`, `elementCache`, `drag` 등 |
| 7 | 알림 | `announce`, `showToast`, `hideToast`, 토스트 타이머 |
| 8 | 실행 취소 | `pushUndo`, `undo` |
| 9 | 상태 변경 | `addTodo`, `deleteTodo`, `toggleTodo`, `clearCompleted`, `reorderTodo` |
| 10 | 필터·정렬 | `compareCreatedDesc`, `COMPARATORS`, `getVisibleTodos` |
| 11 | 렌더링 | `createTodoElement`, `updateTodoElement`, `reconcileChildren`, `render`, `renderSummary`, `calcPercent`, `renderCheer`, `buildCategoryStats`, `highlightTodo` |
| 12 | 격언 | `showQuote`, `showDailyQuote`, `showRandomQuote` |
| 13 | 테마 | `applyTheme`, `initTheme`, `toggleTheme` |
| 14 | 내보내기/가져오기 | `buildExportPayload`, `downloadJson`, `exportTodos`, `handleImportFile`, `openImportDialog`, `updateImportWarning`, `applyImport` |
| 15 | 입력 폼 | `setInputMessage`, `findDuplicate`, 자동 분류 UI(`applyAutoCategory`, `scheduleAutoCategory`, `resetAutoCategory` 등), `clearSearch`, submit 핸들러 |
| 16 | 목록 이벤트 | `itemFromEvent`, `handleDelete`, `moveByKeyboard`, 드래그(`setDropIndicator`, `endDrag`) |
| 17 | 컨트롤 | 필터, 정렬, 검색(`applySearch`), 대화상자(`finishImportDialog`), 토스트 |
| 18 | 전역 단축키 | `/`, Ctrl/⌘+Z, Esc |
| 19 | 생명주기 | 저장 flush, `storage` 이벤트(탭 동기화), 1분 주기 갱신, 전역 에러 처리 |
| 20 | 초기화 | `init()` |

---

## 3. 데이터 모델

### 3.1 Todo
```ts
type Todo = {
  id: string;          // crypto.randomUUID(), 없으면 시간+난수
  text: string;        // sanitizeText 적용, 1~200자
  completed: boolean;
  category: 'work' | 'personal' | 'study';
  createdAt: string;   // ISO 8601(UTC, toISOString). 문자열 비교로 시간순 정렬
};
```
- 배열 `todos` 하나가 유일한 상태 원본입니다. **배열 순서 = 직접 정렬 순서**이고, 새 항목은 `unshift`로 맨 앞에 넣습니다.

### 3.2 localStorage 키
| 키 | 값 | 비고 |
|---|---|---|
| `todos` | `Todo[]` JSON | 메인 데이터 |
| `todo_filter` | `all` \| 카테고리 | 잘못된 값이면 `all` |
| `todo_sort` | `status` \| `created` \| `category` \| `manual` | 없으면 첫 실행으로 보고 마이그레이션 |
| `todo_theme` | `light` \| `dark` | 없으면 OS 설정 |
| `todo_auto_category` | `'0'` \| `'1'` | `'0'`이면 끔. 기본은 켬 |
| `todos_corrupted_backup` | 원본 문자열 | 손상 데이터 보존용 |

### 3.3 내보내기 파일 형식
```json
{ "app": "my-tasks", "version": 1, "exportedAt": "ISO", "count": 3, "todos": [ ... ] }
```
- 가져오기는 이 형식과 순수 `Todo[]` 배열을 모두 받습니다.
- `version`이 더 높으면 경고를 기록하고, 아는 필드만 가져옵니다.

### 3.4 정규화 규칙(`normalizeTodo`)
외부 데이터(저장소, 파일, 다른 탭)는 모두 이 규칙을 거칩니다.

| 필드 | 규칙 |
|---|---|
| 객체 아님 / `text` 문자열 아님 / 정리 후 빈 문자열 | 버림(`skipped`로 셈) |
| `id` | 문자열이나 유한한 숫자면 사용, 아니면 새로 생성. 목록 안에서 중복되면 새 id |
| `completed` | `=== true`일 때만 true |
| `category` | 유효하면 그대로, 아니면 `classifyText(text)`로 추정, 그래도 모르면 `personal` |
| `createdAt` | 해석할 수 있으면 ISO로 통일, 아니면 현재 시각 |

---

## 4. 핵심 설계

### 4.1 상태 변경 흐름
```
사용자 동작 → 상태 변경 함수(todos 수정) → saveTodos() → render()
                                              │
                                              └ 300ms 디바운스 → writeTodosNow()
                                                 (pagehide / visibilitychange(hidden) / beforeunload 때 flushSave())
```
- 새 기능도 반드시 이 순서를 따릅니다. 저장과 화면이 어긋나지 않게 하기 위해서입니다.
- 저장에 실패하면 토스트로 **한 번만** 알립니다(`storageErrorNotified`). 성공하면 플래그를 초기화합니다.

### 4.2 렌더링(성능)
- `elementCache: Map<id, {li, handle, checkbox, text, tag, time, del, signature}>`
  - signature = id, text, completed, category, createdAt, 상대 시간 표시, manual 여부
  - signature가 같으면 DOM을 건드리지 않습니다. 다르면 요소를 새로 만들지 않고 **그 자리에서 고칩니다**(포커스 유지).
- `reconcileChildren(list, nodes)`: 제자리에 있는 노드는 그대로 두고, 위치가 다른 노드만 `insertBefore`로 옮기고, 남은 노드는 제거합니다.
- 노드를 옮기면 포커스가 풀릴 수 있어서, 렌더링 전 `activeElement`를 기억했다가 되돌립니다.
- 화면에서 사라진 id의 캐시는 렌더링마다 정리합니다.
- 등장 애니메이션은 새 항목(`newItemIds`)에만 `is-new` 클래스로 주고, `animationend`에서 지웁니다. 노드를 옮길 때 다시 재생되지 않게 하기 위해서입니다.
- CSS `content-visibility: auto`로 화면 밖 항목의 렌더링을 건너뜁니다. 대신 박스 밖으로 나가는 의사 요소는 잘리므로, 드롭 표시선은 inset 그림자로 그립니다.
- 통계는 `renderSummary`에서 `todos`를 한 번만 순회해 계산합니다. 카테고리 막대는 처음에 한 번 만들고 값만 갱신합니다.
- 1분 주기 갱신은 탭이 숨겨져 있으면 건너뜁니다. signature 덕분에 시간 표시가 바뀐 항목만 갱신됩니다.

### 4.3 디바운스
| 대상 | 지연 | 비고 |
|---|---|---|
| 저장 | 300ms | `flush`로 즉시 실행 가능 |
| 검색 | 200ms | Esc로 지우면 `cancel` |
| 자동 분류 | 150ms | 제출 직전에 `flush`(빠른 Enter 대응) |

`debounce()`는 `flush`, `cancel`, `pending` 메서드를 제공합니다.

### 4.4 정렬
- `status`: 미완료 먼저, 그다음 최신순(기본값)
- `created`: 최신순(ISO 문자열 비교)
- `category`: `CATEGORY_ORDER` 순서, 그다음 최신순
- `manual`: 배열 순서 그대로

`getVisibleTodos()`는 `filter`로 새 배열을 만든 뒤 정렬하므로 원본을 바꾸지 않습니다.

**첫 실행 마이그레이션**: `todo_sort` 키가 없으면 기존 배열(오래된 순으로 쌓여 있음)을 최신순으로 한 번 정렬합니다. 직접 정렬 모드의 시작 순서를 자연스럽게 하기 위해서입니다.

### 4.5 직접 정렬
- **드래그**: HTML5 네이티브. 직접 정렬 모드에서만 `li.draggable = true`이고, 다른 모드에서는 `dragstart`를 막습니다.
  - `dragover`: 항목 높이의 절반을 기준으로 before/after를 정합니다. 빈 공간이면 마지막 항목 뒤로 놓습니다. 표시선은 위치가 바뀔 때만 갱신합니다.
  - Firefox 호환을 위해 `dataTransfer.setData`를 호출합니다.
- **키보드**: 핸들에서 ↑/↓를 누르면 보이는 이웃 항목 기준으로 `reorderTodo(id, targetId, before|after)`를 호출합니다. 이동 후 핸들에 포커스를 되돌리고 위치를 음성으로 안내합니다.
- `reorderTodo`는 전체 배열 기준으로 옮기므로 필터·검색 중에도 올바르게 동작합니다.

### 4.6 실행 취소
- `undoStack`은 최대 20개입니다.
  - `{type:'remove', label, items:[{todo, index}]}`: 원래 인덱스의 **오름차순**으로 다시 끼워 넣어 순서를 정확히 복원합니다. 이미 있는 id는 건너뜁니다.
  - `{type:'snapshot', label, previous}`: 가져오기 전 배열로 되돌립니다.
- 다른 탭에서 동기화되면 스택을 비웁니다. 기준 데이터가 바뀌어 꼬이는 것을 막기 위해서입니다.

### 4.7 자동 카테고리 분류
1. `CATEGORY_KEYWORDS[category] = { strong: [...], weak: [...] }`를 시작할 때 `CATEGORY_RULES`로 한 번 컴파일합니다.
   - 영문·숫자로만 된 키워드는 `\b` 단어 경계 정규식으로, 한글이 섞인 키워드는 `includes`로 비교합니다.
2. `classifyText(text)`는 소문자로 바꾼 뒤 일치하는 규칙의 가중치(strong 2, weak 1)를 카테고리별로 더합니다.
   - 일치 없음 → `null`
   - 최고점 동점 → `{category: null, ambiguous: [...]}`
   - 그 외 → `{category, keywords(가중치 높은 순)}`
3. 입력 폼의 상태는 두 가지입니다.
   - `categoryManuallySet`: 이번 입력에서 사용자가 직접 골랐는지
   - `baseCategory`: 키워드가 없을 때 돌아갈 값(마지막으로 직접 고른 값)
4. 동작:

   | 상황 | 동작 |
   |---|---|
   | 직접 고름 | select 값을 바꾸지 않고, 추천이 다르면 안내만 |
   | 일치 없음 | `baseCategory`로 복귀 |
   | 동점 | `baseCategory`로 복귀 + 애매함 안내 |
   | 판정됨 | select 변경(변화 강조 애니메이션) + 근거 키워드 안내 |
   | 추가 후 | `resetAutoCategory()`: 직접 선택 플래그 해제, `baseCategory`로 복귀 |

5. 사전 작성 원칙: 다른 단어 안에 흔히 들어가는 짧은 한글(예: '책' → '책상', '정책')은 넣지 않습니다. 모두 소문자로 적습니다.

### 4.8 가져오기 흐름
```
파일 선택 → 크기 확인(0 / 5MB) → file.text() → BOM 제거 → JSON.parse
  → 배열 또는 {todos} 추출 → 1만 개 제한 → normalizeTodoList → 유효 0개면 중단
  → 대화상자(합치기 기본, 기존 데이터가 있으면 백업 기본 켬)
  → 확인: [백업 다운로드(실패하면 계속할지 확인)] → 스냅샷 → 합치기 또는 덮어쓰기 → 저장, 렌더링 → 실행 취소 토스트
```
- **합치기**: 같은 id이고 텍스트도 같으면 건너뜁니다. id만 겹치면 새 id를 줘서 추가합니다.
- **대화상자 처리**: 버튼은 form의 `submit` 이벤트(동기)에서 처리합니다. `e.submitter.value`로 confirm/cancel을 구분하고 `dialog.close()` 후 `finishImportDialog`를 호출합니다. Esc로 닫는 경우만 `close` 이벤트로 처리합니다.
  - 이렇게 한 이유: `close` 이벤트는 비동기라 헤드리스 환경에서 오지 않는 것이 관찰됐습니다. 그래서 확인 처리를 `close` 이벤트에 맡기지 않습니다.
- `<dialog>`를 지원하지 않으면 `confirm()`으로 대체합니다(합치기만).
- 같은 파일을 다시 고를 수 있게 처리 후 `input.value = ''`로 비웁니다.

### 4.9 알림과 접근성
- `announce(msg, {assertive})`: 라이브 영역을 비웠다가 50ms 뒤에 넣어서 같은 문구도 다시 읽히게 합니다.
- `showToast`: 시각적 표시와 `announce`를 함께 합니다(오류는 assertive). 실행 취소할 수 있는 작업이면 "Ctrl+Z" 안내를 덧붙입니다.
- **포커스 관리**:
  - 삭제 후 다음 항목, 완료 항목 삭제 후 입력창
  - 대화상자가 닫히면 가져오기 버튼
  - 토스트가 닫히는데 포커스가 그 안에 있었으면 입력창
- **ARIA**:
  - 항목의 체크박스·삭제·핸들에 `"텍스트" 완료 표시`처럼 할 일 이름이 들어간 레이블
  - 필터 `aria-pressed`, 진행률 `role=progressbar` + `aria-valuenow/valuetext`
  - 입력창 `aria-describedby`(분류 안내, 경고), `aria-invalid`
- **단축키 예외**: 입력 중에는 단축키를 처리하지 않습니다(`isEditable`). 단, 입력창이 비어 있으면 Ctrl+Z를 앱의 실행 취소로 처리합니다. 대화상자가 열려 있으면 전역 단축키를 쓰지 않습니다.

### 4.10 오류 처리 요약
| 상황 | 처리 |
|---|---|
| localStorage 접근 예외 | `storage` 래퍼가 잡고 null/false 반환. 앱은 계속 동작 |
| 저장 데이터 손상 | `todos_corrupted_backup`에 원본 보존, 빈 목록 + 경고 토스트 |
| 저장 실패(용량 등) | 한 번만 오류 토스트("내보내기로 백업하세요") |
| 다른 탭 데이터가 손상됨 | 무시하고 경고만 기록 |
| 이 탭에 저장 대기 중일 때 다른 탭 변경 | 이 탭 내용을 우선(반영하지 않음) |
| 백업 파일 생성 실패 | 계속 가져올지 확인 |
| 예상하지 못한 예외 / Promise 거부 | `error` / `unhandledrejection` 리스너 → 기록 + 오류 토스트 |
| 기기 시계 어긋남(미래 시각) | "방금 전"으로 표시 |
| 마크업과 스크립트 불일치 | `$()`가 시작할 때 명확한 메시지로 예외 |

---

## 5. 반응형 레이아웃 설계(`style.css`)

### 5.1 원칙
- 색은 `:root` 변수로만 정의하고, `[data-theme="dark"]`에서 덮어씁니다. 하드코딩한 색을 추가하지 않습니다.
- 전역 `* { transition }`은 쓰지 않습니다(항목이 많을 때 느려짐). 필요한 요소에만 지정합니다.
- 데스크톱 버전과 모바일 버전을 따로 두지 않고, 이 파일 하나로 모든 폭을 처리합니다.

### 5.2 중단점과 그리드
| 폭 | `grid-template-areas` | 스크롤 | 입력 폼 고정 |
|---|---|---|---|
| ~859px | `"sidebar" "main" "insights"` | 페이지 | 안 함(모바일에서 화면을 너무 많이 가림) |
| 860~1199px | `"sidebar insights" "sidebar main"` | 페이지(사이드바는 sticky, 100vh) | 함 |
| 1200px~ | `"sidebar main insights"` (260px / 1fr / 340px) | 열마다 따로(`overflow-y: auto`) | 함 |

### 5.3 폭별 세부 사항
- **859px 이하**:
  - 사이드바 섹션 제목은 시각적으로만 숨깁니다(스크린 리더용으로 유지).
  - 카테고리 버튼 4개가 한 줄에 들어가도록 여백을 줄였습니다.
  - 토스트 여백은 `.insights` 아래에 둡니다.
- **860~1199px**: `.insights`가 얇은 띠입니다.
  - 격언(1) : 진행 현황(1.5)의 2칸이고, 진행 현황 안도 [전체 진행률 + 응원 | 오늘 추가 + 카테고리 막대] 2칸입니다.
  - "진행 현황" 제목은 시각적으로만 숨깁니다.
- **860px 이상**:
  - 사이드바 필터를 세로 메뉴로 바꿉니다(색 점은 `::before`로 그려서 버튼 텍스트에 영향 없음).
  - 데이터 버튼을 세로로 쌓습니다.
  - 항목을 한 줄로 배치합니다(텍스트 | 카테고리·시간).
- **860px 이상이면서 마우스(hover) 환경**: 삭제 버튼은 `opacity: 0`이고, `:hover`나 `:focus-within`일 때 보입니다.
- **본문 폭**: `.main-inner { max-width: 1040px }`
- **한글 줄바꿈**: `word-break: keep-all` + `overflow-wrap: anywhere`(할 일 텍스트, 응원 문구, 격언, 대화상자 요약)

### 5.4 고정 입력 폼과 스크롤
```css
html, .main { scroll-padding-top: calc(var(--sticky-h, 0px) + 12px); }
```
- 1200px 미만은 `html`이, 이상은 `.main`이 스크롤 컨테이너입니다.
- `--sticky-h`는 보조 스크립트가 채웁니다(2.1절).
- 분류 안내와 경고 문구는 `:empty`일 때 숨겨서 평소 고정 영역 높이를 최소화합니다.

---

## 6. 검증 방법(테스트 하네스)

Node.js가 없어서 **헤드리스 Edge**로 검증합니다.
```
msedge.exe --headless=new --disable-gpu --allow-file-access-from-files ^
  --user-data-dir=<매번 새 폴더> --virtual-time-budget=8000 --dump-dom file:///<테스트.html>
```

### 6.1 하네스 구성
- 실제 `index.html`을 복사해 만듭니다.
- 앞에는 localStorage 시드 스크립트를, `script.js` 뒤에는 테스트 스크립트를 끼워 넣습니다.
- 결과는 `<pre id="__out">`에 쓰고 `--dump-dom`으로 읽습니다.
- 스크린샷: `--screenshot --window-size=W,H`.
  - 헤드리스 창은 약 500px보다 좁아지지 않으므로 모바일 폭은 390px 너비의 `<iframe>`으로 확인합니다.

### 6.2 알게 된 헤드리스 제약
| 현상 | 대응 |
|---|---|
| `--virtual-time-budget` 없이 실시간(`--timeout`)으로 돌리면 `setTimeout`이 진행되지 않음 | 가상 시간 사용 |
| 가상 시간에서는 파일 읽기(`file.text()`) 같은 실제 I/O를 시간이 기다려 주지 않음 | 고정 대기 대신 `await handleImportFile()`을 직접 호출 |
| 모달을 닫은 뒤 다음 비동기 작업이 멈춤 | 시나리오마다 새 페이지 로드 |
| 부드러운 스크롤 애니메이션이 진행되지 않음 | 테스트에서만 `scrollIntoView`를 instant로 바꿔 **최종 위치**를 검증 |
| `--user-data-dir`이 이전 프로세스에 잠김 | 매번 새로운 폴더 이름 사용 |

### 6.3 자동화 테스트 범위
| 묶음 | 개수 | 내용 |
|---|---|---|
| 회귀 | 32 | 불러오기·정규화, 추가·빈 입력·중복, 노드 재사용, 삭제와 위치 복원, Ctrl+Z, 정렬과 저장, 키보드 이동과 포커스, 검색 디바운스, 저장 디바운스, 합치기·덮어쓰기·실행 취소, XSS, 진행률 계산, 이모지 자르기 |
| 자동 분류 | 34 | 분류 정확도 10문장, null·동점·단어 경계·정규식 특수문자, 입력 흐름(자동, 재분류, 복귀, 애매함), 빠른 Enter, 수동 선택 존중·추천, 끄기·저장·다시 켜기, 정규화 시 추정 |
| 드래그 | 6 | 모드 제한, 표시선, 순서 변경, 정리, 맨 위로 이동, 저장 |
| 가져오기 | 13 | 대화상자·요약·기본값, 합치기, 포커스 복귀, 덮어쓰기와 실행 취소, 취소, 오류 파일 5종, BOM |
| 레이아웃 측정 | 5개 폭 | 가로 스크롤, 고정 영역 높이, 첫 화면 항목 수, 중복 강조 가시성 |
