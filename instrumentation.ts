export async function register() {
  // Only the Node runtime can hold a timer and reach the database.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMailScanScheduler } = await import("@/services/mail-scheduler");
  startMailScanScheduler();
}
