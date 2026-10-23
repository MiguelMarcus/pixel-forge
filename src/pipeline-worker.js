/* Isolated CPU work; terminating this worker cancels the current conversion. */
importScripts('core.js' + self.location.search);
self.onmessage = function (event) {
  try {
    self.postMessage({ result: self.PF.conform(event.data.image, event.data.options) });
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  }
};
