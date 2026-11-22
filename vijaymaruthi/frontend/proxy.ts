import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Auth is only enforced in deployed (supabase) mode. Local dev with the
// FastAPI backend stays open for convenience.
const AUTH_ENABLED = process.env.NEXT_PUBLIC_DATA_MODE === "supabase";

const PUBLIC_PATHS = new Set(["/login", "/signup"]);

export default async function proxy(request: NextRequest) {
  if (!AUTH_ENABLED) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() validates the JWT on every request (not just the
  // cookie). It also silently refreshes the session when it's close to expiry.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (user && isPublic) {
    const url = new URL("/", request.url);
    return NextResponse.redirect(url);
  }

  if (!user && !isPublic) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

// Protect everything except API routes (they enforce their own auth),
// static assets and images.
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
