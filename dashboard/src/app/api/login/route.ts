import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    // 帳號：tim，密碼：pstcom
    if (username === "tim" && password === "pstcom") {
      const cookieStore = await cookies();
      cookieStore.set("auth_session", "session_verified_tim", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 天
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "帳號或密碼錯誤" },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "無效的請求" },
      { status: 400 }
    );
  }
}
