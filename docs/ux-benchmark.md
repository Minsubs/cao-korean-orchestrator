# UX 벤치마크 — 채택 포인트 요약

각 제품에서 "무엇을" 가져오고 "무엇을" 가져오지 않는지 기록한다. 시각 디자인/코드는 복제하지 않는다.
(설계 확정본: 목업 v9 — MS Orchestrator)

| 제품 | 채택 | 이 프로젝트에서의 구체화 | 배제 |
|---|---|---|---|
| **Warp** | Agent 작업과 Terminal 출력의 분리, 필요할 때만 터미널 펼침, 실행/결과 단위의 시각 분리 | Thread에는 카드(계획/위임/결과)만, raw 출력은 하단 Workbench(기본 접힘)에서만. `mode=last` 추출을 카드 결과로 사용 | 터미널 자체를 주 화면으로 삼는 구성 |
| **VS Code** | Activity Bar+사이드바+하단 패널 셸, Extensions의 Installed/Updates 분리와 정보 밀도, 전역/워크스페이스 범위 구분, Command Palette | 좌측 레일 5항목, Workbench 도킹(접기/높이), 도구및확장 탭(개요/설치됨/탐색/업데이트/소스/환경프로필/진단) + Scope 필터(Global/User/Project/Built-in), ⌘K 팔레트 | 무거운 확장 마켓 UI 전체 복제 |
| **Linear** | 조밀하지만 읽기 쉬운 리스트, 상태를 아이콘+텍스트 필로, Activity Timeline, 카드 남용 금지, 키보드 중심 | 상태 필(`st-*`) 6종 통일, 스레드=타임라인, 목록은 `list-row` 밀도 유지 | 이슈 트래커 도메인 모델 |
| **JetBrains IDE** | Marketplace/Installed 분리, 의존성·호환성 표시, 재시작 필요 상태, Built-in 보호 | 확장 상세의 요구 실행 파일/호환 CLI 버전, "새 세션 필요"·"재시작 필요" 칩, Built-in 삭제/비활성 차단+사유 | 플러그인 저장소 프로토콜 |
| **Claude Code / Codex Plugin Manager** | 설치됨/탐색 분리, Source(마켓플레이스) 관리, 포함 구성요소(Skills/Agents/Hooks/MCP) 표시, 설치≠활성 구분, 새 세션 안내 | 확장 상세의 "포함 구성 요소" 칩, Git URL/로컬 설치 전 Preview(실행 계획·Hook·권한), interactive-only 기능은 Terminal fallback | TUI 문자열 파싱 자동화 |
| **Raycast** | 검색 중심 팔레트, 키보드만으로 이동·실행 | ⌘K/Ctrl+K, 그룹핑된 명령, ↑↓⏎ 네비게이션 | 런처 생태계 |
| **Docker Desktop** | 로컬 Runtime 상태·환경 진단·구성 요소 상태·오류와 복구 동작·현재 연결 환경 표시 | 도구및확장 개요(OS/arch/shell/WSL/server), 진단 카드(심각도·원인·영향·권장 조치·복구 Preview), TopBar 환경 칩 | 리소스 그래프 등 무관 요소 |

## 종합 원칙 (요구사항 §2와의 대응)
- Chat First: 중앙 스레드가 주 화면, 관리 표는 보조 화면으로.
- Progressive Disclosure: raw 출력·내부 메시지·스택트레이스·Manifest는 기본 접힘.
- No Virtual Office: 마스코트는 브랜드/빈 상태 일러스트에 한정 — 이동·회의 연출 없음.
- 작업 상태 중심: 역할·현재 작업·상위 Supervisor·대기 이유·위치(하위 프로젝트) 칩. 데이터 없으면 "확인할 수 없음".
- Capability 기반: 미지원 동작은 비활성+사유 툴팁 (예: Built-in 삭제 불가, agy 활성/비활성 미지원).
