import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 取得驗證狀態
  const authSession = request.cookies.get("auth_session")?.value;
  const validUsers = (process.env.SYS_VALID_USERS || "tim,wenhe,frank,jason,oscar,levi,ren,allison,chanel,sage,stace,albert").split(",");
  const isAuthenticated = !!authSession && validUsers.some(u => authSession === `session_verified_${u}`);

  const isAuthPage = pathname === "/login";
  const isAuthApi = pathname === "/api/login";

  // 0. 如果是登入 API，直接放行，不進行攔截與重導向
  if (isAuthApi) {
    return NextResponse.next();
  }

  // 1. 如果是 API 請求 (排除登入 API)
  if (pathname.startsWith("/api") && !isAuthApi) {
    if (!isAuthenticated) {
      return new NextResponse(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    }
    return NextResponse.next();
  }

  // 2. 如果是頁面請求且未登入，重導向到 /login
  if (!isAuthenticated && !isAuthPage) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // 3. 如果已登入且嘗試訪問 /login，重導向回首頁
  if (isAuthenticated && isAuthPage) {
    const homeUrl = new URL("/", request.url);
    return NextResponse.redirect(homeUrl);
  }

  return NextResponse.next();
}

// 排除不需要過濾的 Next.js 內部檔案及靜態檔案
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\..*).*)",
  ],
};
