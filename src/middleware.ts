import { clerkMiddleware } from '@clerk/nextjs/server';

// In development mode, Clerk's auth().protect() fails on mobile browsers
// that block third-party cookies (*.clerk.accounts.dev).
// Let the middleware pass through and let individual API routes
// handle their own auth checks gracefully.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
