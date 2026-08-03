// 최소 히스토리 라우터. 콘솔 라우트가 열 개도 안 돼 라우팅 라이브러리를 얹을
// 이유가 없다. 서버는 /admin/* 전부를 SPA 셸로 돌려주므로 새로고침도 안전하다.

const ROOT = "/admin";

export interface Route {
  /** 첫 세그먼트 — 사이드바 활성 표시에 쓴다. */
  section: string;
  /** 두 번째 세그먼트 (릴리즈 상세의 id 등) */
  param: string | null;
}

function parse(pathname: string): Route {
  const rest = pathname.startsWith(ROOT) ? pathname.slice(ROOT.length) : pathname;
  const segments = rest.split("/").filter(Boolean);
  return { section: segments[0] ?? "dashboard", param: segments[1] ?? null };
}

class Router {
  current = $state<Route>(parse(location.pathname));

  constructor() {
    addEventListener("popstate", () => {
      this.current = parse(location.pathname);
    });
  }

  go(path: string): void {
    const target = path.startsWith("/") ? `${ROOT}${path}` : `${ROOT}/${path}`;
    if (target === location.pathname) return;
    history.pushState({}, "", target);
    this.current = parse(target);
    scrollTo({ top: 0 });
  }

  href(path: string): string {
    return path.startsWith("/") ? `${ROOT}${path}` : `${ROOT}/${path}`;
  }
}

export const router = new Router();

/** 링크 클릭을 라우터로 가로챈다. 새 탭(수식키)·외부 링크는 그대로 둔다. */
export function navigate(event: MouseEvent, path: string): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  router.go(path);
}
