// Message tasks avoid the browser's nested setTimeout clamp. Bounded chunks
// finish installation during warm-up, also when rendering leaves no idle time.
const queues = new WeakMap();
export function scheduleStaticObservation(scene, step) {
  let queue = queues.get(scene);
  if (!queue) {
    queue = { jobs: [], pending: false, timer: null, channel: null, after: null, disposed: false };
    const closeChannel = () => {
      queue.channel?.port1.close(); queue.channel?.port2.close(); queue.channel = null;
    };
    const schedule = () => {
      if (queue.disposed || queue.pending || !queue.jobs.length) return;
      queue.pending = true;
      if (typeof window !== 'undefined' && typeof window.MessageChannel === 'function') {
        if (!queue.channel) { queue.channel = new window.MessageChannel(); queue.channel.port1.onmessage = run; }
        queue.channel.port2.postMessage(0);
      } else queue.timer = setTimeout(run, 0);
    };
    const run = () => {
      queue.pending = false; queue.timer = null;
      if (queue.disposed) return;
      const end = performance.now() + 8;
      do {
        const job = queue.jobs.shift();
        if (!job) break;
        if (!job.cancelled && job.step() && !job.cancelled && !queue.disposed) queue.jobs.push(job);
      } while (performance.now() < end);
      if (queue.jobs.length) schedule(); else closeChannel();
    };
    queue.schedule = () => {
      if (queue.after || queue.pending || queue.disposed) return;
      queue.after = scene.onAfterRenderObservable.addOnce(() => { queue.after = null; schedule(); });
    };
    scene.onDisposeObservable.addOnce(() => {
      queue.disposed = true;
      if (queue.timer !== null) clearTimeout(queue.timer);
      queue.timer = null; queue.pending = false; closeChannel();
      if (queue.after) scene.onAfterRenderObservable.remove(queue.after);
      queue.after = null; queue.jobs.length = 0; queues.delete(scene);
    });
    queues.set(scene, queue);
  }
  const job = { step, cancelled: false }; queue.jobs.push(job); queue.schedule();
  return () => { job.cancelled = true; const index = queue.jobs.indexOf(job); if (index >= 0) queue.jobs.splice(index, 1); };
}
