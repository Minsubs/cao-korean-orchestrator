import json
import re

from playwright.sync_api import expect, sync_playwright


def wait_for_app(page):
    page.goto("http://127.0.0.1:9889", wait_until="domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=5_000)
    except Exception:
        # The workspace intentionally polls active sessions.
        pass
    page.get_by_text("MS Orchestrator", exact=True).wait_for(timeout=10_000)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors: list[str] = []
    page.on(
        "console",
        lambda message: errors.append(f"console:{message.type}:{message.text}")
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: errors.append(f"pageerror:{error}"))
    wait_for_app(page)

    metrics: dict[str, object] = {}

    # Discover: exact catalog counts, direct chip semantics, search and provider.
    page.get_by_role("tab", name="도구 및 확장").click()
    page.get_by_role("heading", name="도구 및 확장").wait_for()
    page.get_by_role("tab", name="탐색·추천").click()
    page.get_by_role("button", name="Plugin 13", exact=True).wait_for()
    expected_chips = {"전체": 35, "MCP": 7, "Plugin": 13, "Skill": 14, "CLI": 1}
    for label, count in expected_chips.items():
        expect(
            page.get_by_role("group", name="종류 필터").get_by_role(
                "button", name=f"{label} {count}", exact=True
            )
        ).to_be_visible()

    plugin_chip = page.get_by_role("group", name="종류 필터").get_by_role(
        "button", name="Plugin 13", exact=True
    )
    plugin_chip.click()
    expect(plugin_chip).to_have_attribute("aria-pressed", "true")
    expect(
        page.get_by_role("group", name="종류 필터").get_by_role(
            "button", name="전체 35", exact=True
        )
    ).to_have_attribute("aria-pressed", "false")
    expect(page.get_by_role("option")).to_have_count(13)
    expect(page.get_by_text("검색 결과 13개 / 전체 35개", exact=True)).to_be_visible()
    metrics["discover_plugin_count"] = page.get_by_role("option").count()
    page.screenshot(path=".omo/evidence/tooling-plugin-13-after.png", full_page=True)

    search = page.get_by_role("textbox", name="카탈로그 검색")
    search.fill("Cloudflare")
    expect(page.get_by_role("option")).to_have_count(1, timeout=3_000)
    expect(page.get_by_role("option", name=re.compile("Cloudflare", re.I))).to_be_visible()
    search.fill("")
    expect(page.get_by_role("option")).to_have_count(13, timeout=3_000)
    page.get_by_role("group", name="종류 필터").get_by_role(
        "button", name="전체 35", exact=True
    ).click()
    provider_group = page.get_by_role("group", name="Provider 필터")
    codex_chip = provider_group.get_by_role("button", name=re.compile(r"^Codex\s+\d+$"))
    codex_count = int(codex_chip.inner_text().split()[-1])
    codex_chip.click()
    expect(page.get_by_role("option")).to_have_count(codex_count)
    metrics["discover_codex_count"] = codex_count

    # Installed: every kind/scope/provider count and extended search vocabulary.
    page.get_by_role("tab", name=re.compile(r"^설치됨\s+150$")).click()
    expect(page.get_by_role("option")).to_have_count(150)
    expect(page.get_by_text("검색 결과 150개 / 전체 150개", exact=True)).to_be_visible()
    kind_filters = {
        "스킬 (Skill)": 100,
        "플러그인 (Plugin)": 6,
        "에이전트 (Profile)": 38,
        "MCP": 6,
    }
    kind_boxes = {
        label: page.get_by_role("checkbox", name=re.compile(f"^{re.escape(label)}"))
        for label in kind_filters
    }
    for target, expected in kind_filters.items():
        for label, checkbox in kind_boxes.items():
            checkbox.set_checked(label == target)
        expect(page.get_by_role("option")).to_have_count(expected)
    for checkbox in kind_boxes.values():
        checkbox.set_checked(True)
    expect(page.get_by_role("option")).to_have_count(150)

    scope_filters = {"기본 제공 (Built-in)": 17, "직접 설치 (User)": 133}
    scope_boxes = {
        label: page.get_by_role("checkbox", name=re.compile(f"^{re.escape(label)}"))
        for label in scope_filters
    }
    for target, expected in scope_filters.items():
        for label, checkbox in scope_boxes.items():
            checkbox.set_checked(label == target)
        expect(page.get_by_role("option")).to_have_count(expected)
    for checkbox in scope_boxes.values():
        checkbox.set_checked(True)

    installed_search = page.get_by_role("textbox", name="설치된 확장 검색")
    installed_search.fill("Skills (generic)")
    expect(page.get_by_role("option")).to_have_count(91, timeout=3_000)
    installed_search.fill("에이전트")
    expect(page.get_by_role("option")).to_have_count(38, timeout=3_000)
    installed_search.fill("")
    expect(page.get_by_role("option")).to_have_count(150, timeout=3_000)
    metrics["installed_kind_counts"] = kind_filters
    metrics["installed_scope_counts"] = scope_filters

    # Update tab must not fabricate a perpetual pending-update state.
    page.get_by_role("tab", name="업데이트", exact=True).click()
    expect(page.get_by_role("button", name="전체 최신 상태 확인")).to_be_visible()
    expect(page.get_by_role("button", name="모두 업데이트")).to_have_count(0)
    expect(page.get_by_text(re.compile("사전 업데이트 개수를 제공하지 않아"))).to_be_visible()
    metrics["update_state_label"] = "전체 최신 상태 확인"

    # Profiles: all active native specialists remain individual cards and grouped.
    page.get_by_role("tab", name="Agent 프로필").click()
    page.get_by_role("heading", name="AI 팀과 에이전트").wait_for()
    expect(page.locator('[data-testid^="profile-card-"]')).to_have_count(38)
    for profile_name in (
        "frontend-developer",
        "backend-developer",
        "fullstack-developer",
        "observability-engineer",
        "security-engineer",
        "test-runner",
    ):
        expect(page.get_by_test_id(f"profile-card-{profile_name}")).to_be_visible()
    expect(page.get_by_role("heading", name="개발·구현")).to_be_visible()
    expect(page.get_by_role("heading", name="운영·관측")).to_be_visible()
    page.get_by_test_id("profile-card-frontend-developer").scroll_into_view_if_needed()
    page.screenshot(path=".omo/evidence/agent-specialists-after.png")
    metrics["profile_card_count"] = page.locator('[data-testid^="profile-card-"]').count()

    # New task keeps detailed specialists selectable but opt-in.
    page.get_by_role("tab", name="작업공간").click()
    page.get_by_role("button", name="새 작업", exact=True).click()
    dialog = page.get_by_role("dialog", name="새 작업")
    expect(dialog.get_by_text("추가 전문 에이전트 — 필요할 때 선택", exact=True)).to_be_visible()
    developer_group = dialog.locator("details").filter(has_text=re.compile("개발·구현"))
    developer_group.locator("summary").click()
    frontend_checkbox = developer_group.locator("label").filter(
        has_text=re.compile("frontend developer", re.I)
    ).locator('input[type="checkbox"]')
    expect(frontend_checkbox).not_to_be_checked()
    metrics["new_task_specialists_opt_in"] = True
    dialog.get_by_role("button", name="닫기").click()

    metrics["console_errors"] = errors
    assert not errors, errors
    print(json.dumps(metrics, ensure_ascii=False, indent=2), flush=True)
    browser.close()
