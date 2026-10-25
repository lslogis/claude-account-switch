# Account Switch

[English](README.md) · **한국어** · [日本語](README.ja.md)

Claude 구독 계정 여러 개를 **실행 중인 세션 안에서 바로** 갈아타는 Claude Code mod입니다. 재시작이나 새 창이 필요 없고, 다음 메시지부터 고른 계정으로 나갑니다.

```
/account            계정 창: 지금 계정은 초록 테두리 안에, 나머지는 아래 목록에서 고름
/account remove     목록에서 골라 계정 삭제
/account check      진단: 폴더, 파일, 서버 응답, 만료일
```


### Claude 데스크톱 앱에서

데스크톱 앱은 로그인을 직접 세션에 넘겨서, 앱 안에서는 `/account`로 그 자리에서 바꿀 수 없습니다. 대신 데스크톱 앱에서는 **입력창 위에 띠 하나**를 그립니다.

- 세션 상태: 폴더와 git 브랜치, 세션 시간, 프롬프트 수와 비용, 마지막 턴의 모델·시간·캐시 적중률, 대기 시간, 압축 횟수, 돌고 있는 에이전트와 워크플로
- Windows에서는 계정 부분: 컨텍스트, 요금제의 5시간·주간 한도, **계정 버튼**. 다른 계정을 고르면 데스크톱 앱이 그 계정으로 다시 켜집니다(돌던 작업은 멈춤). **Manage accounts…** 에서 계정을 추가·이름 바꾸기·삭제하고, 새 계정으로 처음 바꿀 때 Claude 로그인 화면이 뜹니다
- `/account`는 같은 계정 목록을 엽니다

사용량 한도 80%·95%에서 알림이 옵니다. 이 띠는 데스크톱 앱에서만 그려지고, 터미널에서는 전혀 돌지 않습니다. 반대로 터미널 부분도 데스크톱 앱에서는 돌지 않습니다.

---

## 설치

**필요한 것**
- Claude Code 2.1.306 이상
- Claude 구독 로그인(Pro 또는 Max)
- Windows, macOS, Linux. Windows(Claude Code 2.1.309), macOS(2.1.306), Ubuntu 26.04(2.1.309)에서 시험했습니다.

Claude Code 세션의 입력창에서:

```
/plugin install account-switch --marketplace lslogis/claude-account-switch
```

marketplace를 추가할지 물으면 `y`, 범위는 user를 Enter로 고릅니다. 바로 동작합니다.

셸에서 설치하려면:

```sh
claude plugin install account-switch --marketplace lslogis/claude-account-switch
```

설치 확인: `claude plugin list`에 `account-switch`가 `✔ enabled`로 나오면 됩니다.

## 처음 쓸 때

설정할 것은 없습니다.

1. 세션이 시작되면 지금 로그인된 계정을 자동으로 등록합니다.
2. 상태줄에 `● 이메일 · 플랜`이 뜹니다.
3. 다른 계정을 추가하려면 `/account`를 열고 **`+ Log in to another account`**를 고른 뒤, 브라우저에서 그 계정으로 로그인합니다. 목록에 추가되고 그 계정이 지금 계정이 됩니다. `/login`을 직접 쳐도 똑같이 등록됩니다.

## 사용법

### `/account`: 고르고 바꾸기

```
╭─────────────────────────────────╮
│ ● IN USE  you@example.com · Pro │           ← 초록 테두리
╰─────────────────────────────────╯
Switch to — ↑↓/Tab then Enter · Esc closes

○ work@example.com · Max                      ← 파랑, 선택된 줄은 반전

+ Log in to another account                   ← 주황
```

- **고르기:** ↑↓나 Tab으로 이동하고 Enter를 누르면 바로 교체되고, 결과가 토스트로 뜹니다.
- **적용 시점:** **다음 메시지부터**입니다. 이미 진행 중인 답변은 원래 계정으로 끝납니다.
- **만료된 로그인:** 로그인이 만료된 계정을 고르면 교체하지 않고 **로그인 화면**을 엽니다.
- **좁은 터미널:** 창을 열 수 없으면 목록을 글자로 보여 줍니다.

### 나머지 명령

| 명령 | 하는 일 |
|---|---|
| `/account <이메일>` | 창 없이 바로 교체합니다. 앞부분만 써도 됩니다(`/account work`). 여러 개가 맞으면 더 길게 쓰라고 알려 줍니다. |
| `/account remove` | 계정을 고르고 한 번 더 확인하면 목록에서 지웁니다. 지금 쓰는 계정은 나오지 않습니다. 서버의 로그인 자체는 건드리지 않습니다. |
| `/account list` | 목록을 글자로 출력합니다. |
| `/account check` | 진단 정보를 보여 줍니다("문제 해결" 참고). |

### 상태줄과 경고

- 상태줄에는 늘 `● 이메일 · 플랜`이 보입니다.
- 로그인 만료 3일 전부터 `⚠ login expires in Nd`가 붙습니다. 만료되면 `⚠ login expired — log in again`으로 바뀝니다. 목록에도 같은 표시가 뜹니다.

---

## 동작 원리

```
~/.claude/.credentials.json        ← Claude가 읽는 자리 (지금 계정 1개)
                                     macOS에서는 키체인 항목 "Claude Code-credentials"
~/.claude/account-switch.json      ← 보관함: 이메일별 구독 로그인
~/.claude/account-switch.json.bak  ← 보관함의 직전 상태 (자동으로 씀)
```

- **재시작 없이 바뀌는 이유:** Claude Code는 API를 부르기 전에 `.credentials.json`의 수정 시각을 확인하고, 바뀌었으면 토큰을 다시 읽습니다(2.1.309 실행 파일에서 확인). 그래서 파일 안의 구독 로그인만 바꿔 넣으면 실행 중인 세션이 그대로 새 계정으로 넘어갑니다.
- **macOS:** macOS의 Claude Code는 로그인을 키체인에 저장하므로, mod는 `security` 명령으로 그 항목을 읽고 씁니다. 실행 중인 세션이 로그인을 다시 읽을지는 macOS에서도 `~/.claude/.credentials.json`의 수정 시각으로 판단하기 때문에, 키체인을 쓴 뒤 그 파일의 시각만 갱신합니다(`touch`, 내용은 그대로). Claude는 키체인 읽기를 최대 30초 캐시하므로, macOS에서는 교체가 다음 메시지에 반영되기까지 그만큼 걸릴 수 있습니다.
- **바꾸는 범위:** 그 파일 안의 `claudeAiOauth` 하나뿐입니다. 같은 파일의 MCP 서버 로그인(`mcpOAuth`)은 그대로 둡니다.
- **계정 구분:** 누구의 토큰인지 Claude 서버(`/api/oauth/profile`)에 물어서 그 이메일로 저장합니다.
- **최신 토큰 유지:** 세션은 약 8시간짜리 접근 토큰을 갱신해서 `.credentials.json`에 다시 씁니다. mod는 메시지를 보낼 때마다, 그리고 교체 직전에 그 최신 토큰을 해당 계정의 보관함에 저장합니다. 그래서 다른 계정으로 갔다가 돌아와도 최신 토큰으로 돌아옵니다.
- **설정 폴더:** `CLAUDE_CONFIG_DIR`가 설정되어 있으면 `~/.claude` 대신 그 폴더를 씁니다.

## 미리 막아 둔 문제들

| 상황 | mod의 동작 |
|---|---|
| 보관함 파일이 깨짐 | `.bak`(직전 상태)으로 읽고 알립니다. 둘 다 깨졌으면 **아무것도 쓰지 않고 멈춥니다**. 빈 목록으로 덮어써서 토큰을 잃는 일을 막습니다. |
| `.credentials.json`이 깨짐 | 교체를 거부하고 파일을 덮어쓰지 않습니다. MCP 로그인을 지키기 위해서입니다. |
| 지금 토큰이 누구 것인지 서버가 답하지 않음(네트워크) | 짐작으로 아무 계정에나 저장하지 않고, 교체도 거부합니다("잠시 뒤 다시"). 메시지마다 하는 확인은 실패하면 5분 동안 다시 묻지 않습니다. |
| 바꿀 계정의 토큰이 폐기됨(다른 곳에서 로그아웃 등) | 교체 전에 서버로 확인합니다. 거절되면 교체하지 않고 다시 로그인하라고 안내합니다. |
| 바꿀 계정의 로그인이 만료됨 | 교체하지 않고 로그인 화면을 엽니다. |
| 교체하는 순간 세션이 갱신된 토큰을 써 넣음 | 쓴 직후 다시 읽어 확인하고, 밀렸으면 "한 번 더 하세요"라고 알립니다. |
| 다른 Claude 창이 같은 보관함을 동시에 씀 | 저장 직전에 다시 읽어서 계정마다 더 최근 것을 남깁니다. |
| `ANTHROPIC_API_KEY`나 `CLAUDE_CODE_OAUTH_TOKEN`이 설정됨 | 이 값이 구독 로그인보다 우선이라 교체해도 효과가 없습니다. 교체를 거부하고 알립니다. |
| `/login`을 도중에 취소 | 아무것도 바뀌지 않습니다. "Account saved" 알림은 계정이 실제로 바뀐 경우에만 뜹니다. |
| 서버 응답이 느림 | 8초까지만 기다립니다. |
| Linux 파일 권한 | 보관함과 백업을 쓸 때마다 `chmod 600`으로 본인만 읽게 합니다. |

## 알아둘 것

- **같은 설정 폴더를 쓰는 다른 창도 함께 바뀝니다.** 로그인 자리는 폴더당 하나라서, 한 창에서 바꾸면 그 폴더의 다른 Claude 창도 다음 메시지부터 새 계정을 씁니다.
- **계정마다 한 달에 한 번쯤 다시 로그인해야 할 수 있습니다.** 서버가 정한 로그인 만료일(지금 약 4주)은 토큰을 갱신해도 늘어나지 않았습니다(서버 응답으로 확인). 그 날짜에 실제로 로그인이 풀리는지는 아직 확인하지 못했습니다. mod가 3일 전부터 알리고, 만료된 계정을 고르면 로그인 화면이 열립니다.
- **같은 계정을 다른 PC나 다른 설정 폴더에서도 쓰면,** 그쪽의 토큰 갱신 때문에 여기 저장된 토큰이 폐기될 수 있습니다. 교체가 거절되면 그 계정으로 다시 로그인하세요.
- **Claude 자체 화면(`/status` 등)의 이메일**은 Claude가 따로 저장한 값이라 교체 뒤에도 예전 이메일로 보일 수 있습니다. 실제로 쓰는 계정은 mod 상태줄과 `/account check`의 "Server says" 줄을 보세요.
- **`account-switch.json`과 `.bak`에는 로그인 토큰이 들어 있습니다.** 공유하거나 커밋하지 마세요.

## 문제 해결

먼저 `/account check`를 실행하세요.

```
Config folder  C:\Users\you/.claude
Login file     C:\Users\you/.claude/.credentials.json — subscription login present
Account store  C:\Users\you/.claude/account-switch.json — 2 account(s)
In use         you@example.com
Server says    you@example.com                      ← 실제로 쓰이는 계정
  you@example.com · Pro — login expires 2026-11-22
  work@example.com · Max — login expires 2026-11-20
```

| 증상 / 메시지 | 할 일 |
|---|---|
| `/account`가 Unknown command | `/reload-plugins`를 실행합니다. 그래도 안 되면 `claude plugin list`에서 enabled인지 확인하고, 없으면 다시 설치합니다. |
| "Could not confirm the current account's token" | 네트워크 문제입니다. 잠시 뒤 다시 하세요. |
| "token … was refused" 또는 "login … has expired" | `/account`를 열고 그 계정이나 `+ Log in to another account`를 골라 그 계정으로 로그인합니다. |
| "try once more" | 같은 명령을 한 번 더 합니다. |
| "The account store … and its backup are both broken" | `~/.claude/account-switch.json`과 `.bak`을 열어 확인합니다. 살릴 수 없으면 둘 다 지우고 계정마다 다시 로그인합니다. |
| API 키 또는 `CLAUDE_CODE_OAUTH_TOKEN` 경고 | 그 환경 변수를 지우고 claude를 다시 띄웁니다. |
| 바꿨는데 계속 예전 계정 같음 | `/account check`의 "Server says" 줄을 보세요. 새 계정이 나오면 교체는 된 것이고, 예전 이메일은 Claude 화면 표시만 남은 것입니다. |
| 상태줄에 "No account" | 로그아웃된 상태입니다. `/account`에서 고르거나 `/login`을 합니다. |
| "Could not read the macOS Keychain … is it locked?" | 키체인이 잠겨 있습니다(SSH 세션 등). Mac 화면의 터미널에서 claude를 실행하세요. |
| macOS에서 교체가 다음 메시지에 반영되지 않음 | 30초쯤 기다렸다가 한 번 더 보내세요. Claude가 키체인 읽기를 그만큼 캐시합니다. |

## 제거

```sh
claude plugin uninstall account-switch
```

보관함 `~/.claude/account-switch.json`(과 `.bak`)은 남습니다. 필요 없으면 직접 지우세요. 지금 로그인된 계정은 그대로 유지됩니다.

## 개발

클론한 폴더에서 mod를 바로 불러 세션을 띄웁니다.

```sh
claude --plugin-dir /path/to/claude-account-switch
```

`hooks/register.tsx`를 고친 뒤에는 그 세션에서 `/reload-plugins`를 실행합니다. Claude Code 2.1.309보다 오래된 버전은 `/reload-plugins`로 폴더를 다시 읽지 않으니 claude를 재시작하세요. `claude plugin validate .`로 manifest와 모듈을 검사하고, Claude Code가 mod를 한 번 불러온 뒤에는 `tsc -p .`로 타입 검사를 할 수 있습니다.

```
.claude-plugin/plugin.json        mod 정보
.claude-plugin/marketplace.json   이 저장소를 /plugin install로 설치할 수 있게 함
hooks/hooks.json                  모듈 목록
hooks/register.tsx                연결: 각 훅을 터미널 쪽이나 데스크톱 쪽으로 보냄
hooks/cli/account.tsx             터미널: /account 명령, 창, 동기화, 교체, 진단
hooks/desktop/                    데스크톱 앱: 계정 교체(Windows)와 띠의 상태 부분
scripts/                          데스크톱 앱 로그인을 갈아 끼우는 PowerShell 모듈(Windows)
types/index.d.ts                  mod 상태 정의
tsconfig.json                     타입 검사 설정
```

## 라이선스

MIT. 데스크톱 계정 부분(`status.tsx`를 뺀 `hooks/desktop/`, `scripts/`)은 plexxed의 [claude-desktop-account-switcher](https://github.com/plexxed/claude-desktop-account-switcher)에서, 상태 부분(`hooks/desktop/status.tsx`)은 George Liu의 [desktop-statusline](https://github.com/centminmod/claude-plugins)에서 가져왔고 둘 다 MIT입니다. 원문 라이선스는 `licenses/`에 있습니다. 저장된 데스크톱 로그인은 따로 쓰던 때와 같은 `~/.claude/plugins/data/account-switcher/`에 그대로 있습니다.
