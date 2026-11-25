import "./server/index.ts";

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  process.emit("SIGTERM");
}
process.on("message", (message) => {
  if (message?.type === "mesa-shutdown") stop();
});
process.on("disconnect", stop);
