// Late-bound navigation so views don't import the shell (avoids import cycles).
let impl = (p) => { location.href = p; };
let previous = null;
export const setNavigator = (fn) => { impl = fn; };
export const go = (path, opts) => impl(path, opts);
export const setPrevious = (p) => { previous = p; };
export const previousPath = () => previous;
