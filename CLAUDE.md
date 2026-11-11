# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

바닐라 HTML/CSS/JS로 만든 할 일 관리 앱("My Tasks")입니다. 빌드 도구, 패키지 매니저, 프레임워크, 테스트, 린터는 없습니다. git 저장소도 아직 아닙니다.

## 실행 및 검증

`index.html`을 브라우저에서 직접 열면 됩니다. 빌드 단계는 없습니다. Node.js가 없어서 `node --check`는 쓸 수 없습니다. 대신 Edge 헤드리스로 동작을 검증할 수 있습니다. 테스트 HTML을 만들어 `script.js`를 로드하고 결과를 DOM에 쓴 뒤 다음처럼 읽습니다.
`msedge.exe --headless=new --allow-file-access-from-files --user-data-dir=<임시폴더> --virtual-time-budget=5000 --dump-dom file:///...`

## 구조

- `index.html`: 마크업만 담당합니다. 레이아웃은 `.app-shell` 안의 세 블록 `.sidebar`(검색, 필터, 정렬, 자동 분류 토글, 데이터, 단축키), `.main`(고정 입력 폼 `.main-top` + 목록), `.insights`(격언, 진행 현황)로 이루어집니다. `script.js`는 `<body>` 끝에서 로드되고, 스크립트가 쓰는 요소는 `$()`로 id를 찾기 때문에 요소가 없으면 시작할 때 바로 에러가 납니다. 그 뒤에 있는 인라인 보조 스크립트는 고정 입력 폼의 높이를 `--sticky-h` CSS 변수에 넣고, 중복 강조(flash) 때 스크롤 위치를 바로잡습니다. 앱 로직은 없습니다.
- `script.js`: 상태와 렌더링을 담당하며, 번호 붙은 섹션으로 나뉘어 있습니다.
  - 모듈 범위의 `todos` 배열 하나가 유일한 상태 원본입니다. 항목 형태는 `{ id, text, completed, category, createdAt }`이고, `createdAt`은 ISO 문자열입니다. 정렬할 때는 문자열 비교를 씁니다.
  - 배열 순서가 곧 '직접 정렬(manual)' 순서이고, 새 항목은 `unshift`로 맨 앞에 넣습니다.
  - 상태를 바꾸는 함수는 모두 `todos` 수정 → `saveTodos()` → `render()` 순서를 따릅니다. `saveTodos()`는 300ms 디바운스되고, `pagehide`/`visibilitychange` 때 `flushSave()`로 즉시 저장됩니다.
  - 외부에서 들어온 데이터(localStorage, 가져온 파일, 다른 탭)는 반드시 `normalizeTodoList()`를 거칩니다.
  - `render()`는 `elementCache`(id → li와 하위 요소 참조)를 재사용합니다. `updateTodoElement`는 signature가 바뀐 항목만 갱신하고, `reconcileChildren`은 순서가 바뀐 노드만 옮깁니다. 항목마다 요소를 새로 만들지 마세요(포커스 유지와 성능 때문).
  - 목록 이벤트(change, click, keydown, drag*)는 모두 `#todo-list` 위임 리스너로 처리하고, 항목은 `li.dataset.id`로 찾습니다.
  - 삭제와 가져오기는 `undoStack`에 기록합니다(`remove` 또는 `snapshot`). 실행 취소할 수 있는 새 작업도 `pushUndo`를 쓰세요.
  - 사용자 입력은 반드시 `textContent`로 넣습니다(`innerHTML` 사용 금지, XSS 방지).
  - 스크린 리더 알림은 `announce()`, 화면 알림은 `showToast()`를 씁니다.
  - 자동 카테고리 분류: 키워드 사전은 `CATEGORY_KEYWORDS`(strong 2점, weak 1점)입니다. 시작할 때 `CATEGORY_RULES`로 한 번 컴파일하고 `classifyText()`가 점수를 매깁니다. 동점이면 `category: null`을 반환합니다. 한글 키워드는 부분 문자열로 비교하므로 다른 단어 안에 흔히 들어가는 짧은 키워드(예: '책')는 넣지 마세요. 영문 키워드는 단어 경계로 비교합니다. 입력 폼에서는 사용자가 직접 고른 카테고리(`categoryManuallySet`)를 덮어쓰지 않습니다. `normalizeTodo`도 카테고리가 없거나 잘못된 항목에 이 분류를 씁니다.
- `style.css`: 색은 모두 `:root` 변수로 정의하고, `[data-theme="dark"]`에서 덮어씁니다. 하드코딩한 색을 추가하지 마세요. `.todo-item`에는 `content-visibility: auto`가 걸려 있어서 박스 밖으로 나가는 의사 요소는 잘립니다. 앞부분은 공통 컴포넌트 스타일이고, 뒷부분 "데스크톱(웹) 레이아웃" 섹션이 반응형 배치를 맡습니다.
  - 859px 이하: 1단입니다. 순서는 메뉴 → 입력·목록 → 진행 현황이고, 입력 폼은 고정하지 않습니다.
  - 860~1199px: 2단입니다. 사이드바 옆에 격언·진행 현황이 얇은 띠로 놓이고 그 아래에 목록이 옵니다. 페이지 전체가 스크롤되고 입력 폼은 고정됩니다.
  - 1200px 이상: 3단(사이드바 | 목록 | 진행 현황)입니다. 열마다 따로 스크롤됩니다.
  - 고정 입력 폼 때문에 `html`과 `.main`에 `scroll-padding-top: var(--sticky-h)`를 줍니다. 입력 폼 영역에 요소를 더하면 높이가 바뀌는데, 보조 스크립트가 ResizeObserver로 따라갑니다.
  - 데스크톱 버전과 모바일 버전을 따로 두지 않습니다. 이 파일 하나로 모든 화면 폭을 처리합니다.

## 저장소

localStorage 키는 `todos`(데이터), `todo_filter`, `todo_sort`, `todo_theme`, `todo_auto_category`(`'0'`이면 자동 분류 끔)입니다. 데이터가 손상되면 원본을 `todos_corrupted_backup`에 보관하고 빈 배열로 시작합니다. 모든 접근은 `storage` 래퍼(try/catch)를 거칩니다. 내보내기 형식은 `{ app: 'my-tasks', version: 1, exportedAt, count, todos }`이고, 가져오기는 이 형식과 순수 배열을 모두 받습니다. 데이터 구조를 바꿀 때는 기존 데이터와의 호환성을 `normalizeTodo`에서 처리하세요.
