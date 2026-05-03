/**
 * 建立防抖包裝函式。
 * @param {Function} fn 要防抖的函式
 * @param {number} ms 延遲毫秒數
 * @returns {Function}
 */
export const debounce = (fn, ms) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn(...args);
    }, ms);
  };
};
