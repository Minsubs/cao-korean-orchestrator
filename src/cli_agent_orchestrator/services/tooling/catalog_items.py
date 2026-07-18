"""Hand-maintained, immutable entries shown by the tooling catalog."""

from __future__ import annotations

from typing import Tuple

from cli_agent_orchestrator.services.tooling.catalog_models import CatalogItem, InstallSpec

_MCP_SERVERS_REPO = "https://github.com/modelcontextprotocol/servers/tree/main/src"
_ANTHROPIC_SKILLS_REPO = "https://github.com/anthropics/skills"
_VERCEL_SKILLS_REPO = "https://github.com/vercel-labs/skills"


def _mcp_item(
    item_id: str,
    name: str,
    description_ko: str,
    category: str,
    homepage: str,
    argv: Tuple[str, ...],
    *,
    requires_params: Tuple[str, ...] = (),
    warnings: Tuple[str, ...] = (),
) -> CatalogItem:
    spec = InstallSpec(method="mcp", argv=argv, requires_params=requires_params)
    return CatalogItem(
        id=item_id,
        name=name,
        description_ko=description_ko,
        kind="mcp",
        category=category,
        homepage=homepage,
        providers=("claude_code", "codex"),
        install={"claude_code": spec, "codex": spec},
        requires=("npx",),
        new_session_required=True,
        warnings=warnings,
    )


def _skill_item(
    item_id: str,
    name: str,
    description_ko: str,
    category: str = "업무 생산성",
) -> CatalogItem:
    return CatalogItem(
        id=item_id,
        name=name,
        description_ko=description_ko,
        kind="skill",
        category=category,
        homepage=_ANTHROPIC_SKILLS_REPO,
        providers=("generic_skills",),
        install={
            "generic_skills": InstallSpec(method="skill", argv=("anthropics/skills", item_id))
        },
    )


def _claude_plugin_item(
    slug: str,
    name: str,
    description_ko: str,
    category: str,
    homepage: str,
) -> CatalogItem:
    return CatalogItem(
        id=f"claude-plugin-{slug}",
        name=name,
        description_ko=description_ko,
        kind="plugin",
        category=category,
        homepage=homepage,
        providers=("claude_code",),
        install={
            "claude_code": InstallSpec(
                method="manual",
                argv=(
                    "claude",
                    "plugin",
                    "install",
                    f"{slug}@claude-plugins-official",
                ),
            )
        },
        new_session_required=True,
        warnings=("플러그인은 코드를 실행할 수 있으므로 홈페이지와 권한을 확인한 뒤 설치하세요.",),
        manual_reason="Claude Code 공식 마켓플레이스 명령을 복사해 설치하세요",
    )


CATALOG_ITEMS: Tuple[CatalogItem, ...] = (
    _mcp_item(
        "context7",
        "Context7",
        "라이브러리와 프레임워크의 최신 공식 문서를 실시간으로 가져와 코드 예제의 정확도를 높여줘요.",
        "문서",
        "https://github.com/upstash/context7",
        ("npx", "-y", "@upstash/context7-mcp"),
    ),
    _mcp_item(
        "playwright",
        "Playwright",
        "브라우저를 실제로 구동해 웹 페이지를 탐색·조작하고 자동화 작업을 수행해요.",
        "브라우저 자동화",
        "https://github.com/microsoft/playwright-mcp",
        ("npx", "@playwright/mcp@latest"),
    ),
    _mcp_item(
        "sequential-thinking",
        "Sequential Thinking",
        "복잡한 문제를 단계별 사고 과정으로 나눠 체계적으로 추론하도록 도와줘요.",
        "추론",
        f"{_MCP_SERVERS_REPO}/sequentialthinking",
        ("npx", "-y", "@modelcontextprotocol/server-sequential-thinking"),
    ),
    _mcp_item(
        "memory",
        "Memory",
        "지식 그래프 기반으로 대화 사이의 정보를 저장하고 다시 불러와요.",
        "메모리",
        f"{_MCP_SERVERS_REPO}/memory",
        ("npx", "-y", "@modelcontextprotocol/server-memory"),
    ),
    _mcp_item(
        "fetch",
        "Fetch",
        "지정한 URL의 웹 콘텐츠를 가져와 읽기 좋은 형식으로 변환해줘요.",
        "웹",
        f"{_MCP_SERVERS_REPO}/fetch",
        ("npx", "-y", "@modelcontextprotocol/server-fetch"),
    ),
    _mcp_item(
        "filesystem",
        "Filesystem",
        "허용한 로컬 디렉터리의 파일을 안전하게 읽고 쓸 수 있게 해줘요. 접근을 허용할 경로를 지정하세요.",
        "파일시스템",
        f"{_MCP_SERVERS_REPO}/filesystem",
        ("npx", "-y", "@modelcontextprotocol/server-filesystem"),
        requires_params=("path",),
        warnings=("접근을 허용할 디렉터리 경로(홈 디렉터리 내부)를 params.path로 지정해야 해요.",),
    ),
    _mcp_item(
        "github",
        "GitHub",
        "GitHub 저장소·이슈·풀 리퀘스트를 조회하고 다룰 수 있게 해줘요.",
        "개발",
        f"{_MCP_SERVERS_REPO}/github",
        ("npx", "-y", "@modelcontextprotocol/server-github"),
        warnings=(
            "이 서버는 GITHUB_PERSONAL_ACCESS_TOKEN 환경변수가 필요해요 — "
            "토큰 값은 CAO가 저장하거나 다루지 않으며, 사용자가 직접 환경에 설정해야 해요.",
        ),
    ),
    CatalogItem(
        id="generic-skills-cli",
        name="Skills CLI",
        description_ko=(
            "스킬을 설치·관리하는 generic 'skills' CLI예요. "
            "위 스킬 항목을 설치하려면 먼저 이 CLI가 필요해요."
        ),
        kind="cli",
        category="스킬",
        homepage=_VERCEL_SKILLS_REPO,
        providers=("generic_skills",),
        install={
            "generic_skills": InstallSpec(
                method="manual",
                argv=("npm", "install", "-g", "skills"),
            )
        },
        warnings=("npm 전역 환경에 설치돼요 — 표시된 명령은 CAO가 자동 실행하지 않아요.",),
        manual_reason="자동 설치는 지원하지 않아요 — 명령을 복사해 실행한 뒤 다시 검사하세요",
    ),
    _skill_item("docx", "Word 문서", "Word(.docx) 문서를 만들고 편집해요.", "문서"),
    _skill_item("pdf", "PDF", "PDF 문서를 읽고 생성·편집해요.", "문서"),
    _skill_item("pptx", "PowerPoint", "PowerPoint 슬라이드를 만들고 편집해요.", "문서"),
    _skill_item("xlsx", "Excel", "Excel 스프레드시트를 만들고 분석·편집해요.", "문서"),
    _skill_item(
        "claude-api",
        "Claude API",
        "Claude API와 Anthropic SDK의 모델·스트리밍·도구 사용을 안내해요.",
        "AI 개발",
    ),
    _skill_item(
        "skill-creator",
        "Skill Creator",
        "새 Agent Skill을 만들고 기존 스킬의 트리거와 품질을 개선해요.",
        "AI 개발",
    ),
    _skill_item(
        "frontend-design",
        "Frontend Design",
        "템플릿처럼 보이지 않는 의도적인 웹 UI를 설계하고 구현해요.",
        "프런트엔드",
    ),
    _skill_item(
        "webapp-testing",
        "Web App Testing",
        "실제 브라우저로 로컬 웹 앱의 사용자 시나리오와 회귀를 검증해요.",
        "테스트",
    ),
    _skill_item(
        "mcp-builder",
        "MCP Builder",
        "외부 서비스와 연결되는 MCP 서버를 설계하고 구현해요.",
        "AI 개발",
    ),
    _skill_item(
        "doc-coauthoring",
        "문서 공동 작성",
        "요구사항부터 검토까지 구조화된 문서 공동 작성 흐름을 제공해요.",
        "문서",
    ),
    _skill_item(
        "computer-use",
        "Computer Use",
        "브라우저 밖의 데스크톱 앱을 화면 기반으로 조작하고 검증해요.",
        "자동화",
    ),
    _skill_item(
        "theme-factory",
        "Theme Factory",
        "문서·슬라이드·웹 산출물에 일관된 테마를 적용해요.",
        "디자인",
    ),
    _skill_item(
        "canvas-design",
        "Canvas Design",
        "PNG와 PDF용 정적 시각물을 전문적인 레이아웃으로 만들어요.",
        "디자인",
    ),
    _skill_item(
        "algorithmic-art",
        "Algorithmic Art",
        "시드 기반 p5.js 생성형 아트와 인터랙션을 만들어요.",
        "디자인",
    ),
    _claude_plugin_item(
        "github",
        "GitHub",
        "이슈·Pull Request·코드 리뷰와 저장소 검색을 Claude Code에서 연결해요.",
        "개발 협업",
        "https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/github",
    ),
    _claude_plugin_item(
        "gitlab",
        "GitLab",
        "Merge Request·CI/CD·이슈와 저장소 작업을 연결해요.",
        "개발 협업",
        "https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/gitlab",
    ),
    _claude_plugin_item(
        "linear",
        "Linear",
        "이슈 생성·검색·상태 변경과 프로젝트 관리를 연결해요.",
        "업무 관리",
        "https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/linear",
    ),
    _claude_plugin_item(
        "atlassian",
        "Atlassian",
        "Jira와 Confluence의 이슈·스프린트·문서를 연결해요.",
        "업무 관리",
        "https://github.com/atlassian/atlassian-mcp-server",
    ),
    _claude_plugin_item(
        "slack",
        "Slack",
        "채널·메시지·스레드를 검색해 개발 맥락을 가져와요.",
        "커뮤니케이션",
        "https://github.com/slackapi/slack-mcp-plugin",
    ),
    _claude_plugin_item(
        "notion",
        "Notion",
        "페이지·데이터베이스·팀 지식 문서를 검색하고 관리해요.",
        "업무 관리",
        "https://github.com/makenotion/claude-code-notion-plugin",
    ),
    _claude_plugin_item(
        "figma",
        "Figma",
        "디자인 파일·컴포넌트·토큰을 읽고 코드 구현과 연결해요.",
        "디자인",
        "https://github.com/figma/mcp-server-guide",
    ),
    _claude_plugin_item(
        "sentry",
        "Sentry",
        "프로덕션 오류·스택 트레이스·이슈를 조회해 디버깅해요.",
        "모니터링",
        "https://github.com/getsentry/plugin-claude",
    ),
    _claude_plugin_item(
        "supabase",
        "Supabase",
        "데이터베이스·인증·스토리지와 프로젝트 작업을 연결해요.",
        "데이터베이스",
        "https://github.com/supabase-community/supabase-plugin",
    ),
    _claude_plugin_item(
        "vercel",
        "Vercel",
        "배포 상태·빌드 로그·도메인과 프런트엔드 인프라를 연결해요.",
        "배포",
        "https://github.com/vercel/vercel-plugin",
    ),
    _claude_plugin_item(
        "cloudflare",
        "Cloudflare",
        "Workers·Durable Objects·Wrangler와 웹 성능 작업을 지원해요.",
        "배포",
        "https://github.com/cloudflare/skills",
    ),
    _claude_plugin_item(
        "stripe",
        "Stripe",
        "결제 통합과 Stripe 개발 워크플로를 지원해요.",
        "개발",
        "https://github.com/stripe/ai/tree/main/providers/claude/plugin",
    ),
    _claude_plugin_item(
        "asana",
        "Asana",
        "작업·프로젝트·담당자와 진행 상태를 연결해요.",
        "업무 관리",
        "https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/asana",
    ),
)
