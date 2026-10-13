'use strict';

/**
 * Statistics for the harness (program H3). Pure, dependency-free.
 *
 * Five reps cannot separate two variants: 4/5 passes has a 95% Wilson interval of
 * roughly [0.38, 0.96]. Every model-tier claim the harness makes therefore carries an
 * interval, and comparisons are decided sequentially (SPRT) or with a stated
 * non-inferiority margin, never by eyeballing two pass counts.
 *
 *   wilson(s, n)             95% (or z-chosen) score interval for a proportion
 *   passHatK(c, n, k)        tau-bench pass^k: P(all k of k trials pass), unbiased
 *   passAtK(c, n, k)         pass@k: P(at least one of k trials passes), unbiased
 *   pairedSignTest(pairs)    exact two-sided sign test on discordant pairs
 *   sprt(outcomes, opts)     Wald's sequential test for one proportion, p0 vs p1
 *   sprtPaired(pairs, opts)  the same on discordant pairs (does B beat A?)
 *   nonInferiority(a, b, d)  Newcombe interval for b − a; non-inferior if lower > −d
 *   powerN(p1, p2, opts)     reps per arm to separate p1 from p2
 */

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
function normInv(p) {
  if (!(p > 0 && p < 1)) throw new RangeError('normInv: p must be in (0, 1)');
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Wilson score interval. @returns {{p, lower, upper, n}} */
function wilson(successes, n, { confidence = 0.95 } = {}) {
  if (!Number.isInteger(n) || n < 0 || !Number.isInteger(successes) || successes < 0 || successes > n) throw new RangeError('wilson: need integers 0 <= successes <= n');
  if (n === 0) return { p: null, lower: 0, upper: 1, n: 0 };
  const z = normInv(1 - (1 - confidence) / 2);
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return { p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half), n };
}

/** n choose k as a float (exact for the small counts the harness sees). */
function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
  return r;
}

/** tau-bench pass^k: the chance that k independent trials all pass, from c of n. */
function passHatK(c, n, k) {
  if (k > n) return null;
  return choose(c, k) / choose(n, k);
}

/** pass@k: the chance that at least one of k trials passes, from c of n. */
function passAtK(c, n, k) {
  if (k > n) return null;
  return 1 - choose(n - c, k) / choose(n, k);
}

/**
 * Exact two-sided sign test on paired outcomes. `pairs` are [a, b] booleans per item;
 * only discordant pairs carry information.
 * @returns {{aOnly, bOnly, discordant, p}} p is the two-sided binomial p-value
 */
function pairedSignTest(pairs) {
  let aOnly = 0;
  let bOnly = 0;
  for (const [a, b] of pairs) {
    if (a && !b) aOnly++;
    else if (b && !a) bOnly++;
  }
  const n = aOnly + bOnly;
  if (n === 0) return { aOnly, bOnly, discordant: 0, p: 1 };
  const k = Math.min(aOnly, bOnly);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += choose(n, i) / Math.pow(2, n);
  return { aOnly, bOnly, discordant: n, p: Math.min(1, 2 * tail) };
}

/**
 * Wald's sequential probability ratio test for a Bernoulli rate: H0 p = p0 against
 * H1 p = p1 (p1 > p0 or p1 < p0), with error rates alpha and beta.
 * @param {boolean[]|{successes: number, n: number}} outcomes
 * @returns {{decision: 'h0'|'h1'|'continue', llr, lower, upper, n, successes}}
 */
function sprt(outcomes, { p0 = 0.5, p1 = 0.8, alpha = 0.05, beta = 0.2 } = {}) {
  if (!(p0 > 0 && p0 < 1 && p1 > 0 && p1 < 1) || p0 === p1) throw new RangeError('sprt: need 0 < p0, p1 < 1 and p0 != p1');
  const { successes, n } = Array.isArray(outcomes)
    ? { successes: outcomes.filter(Boolean).length, n: outcomes.length }
    : outcomes;
  const llr = successes * Math.log(p1 / p0) + (n - successes) * Math.log((1 - p1) / (1 - p0));
  const upper = Math.log((1 - beta) / alpha);
  const lower = Math.log(beta / (1 - alpha));
  const decision = llr >= upper ? 'h1' : (llr <= lower ? 'h0' : 'continue');
  return { decision, llr, lower, upper, n, successes };
}

/**
 * SPRT on paired outcomes: among discordant pairs, is B the winner more often than
 * chance? H0: B wins half the discordant pairs; H1: B wins `p1` of them.
 * @returns the sprt() result plus {aOnly, bOnly}; decision 'h1' means B beats A
 */
function sprtPaired(pairs, { p1 = 0.75, alpha = 0.05, beta = 0.2 } = {}) {
  const t = pairedSignTest(pairs);
  return { ...sprt({ successes: t.bOnly, n: t.discordant }, { p0: 0.5, p1, alpha, beta }), aOnly: t.aOnly, bOnly: t.bOnly };
}

/**
 * Non-inferiority of B against A at margin `delta`, from the Newcombe hybrid score
 * interval for the difference pB − pA (Newcombe 1998, method 10).
 * @param {{successes, n}} a - the reference (baseline)
 * @param {{successes, n}} b - the candidate
 * @returns {{diff, lower, upper, delta, nonInferior}}
 */
function nonInferiority(a, b, delta, { confidence = 0.95 } = {}) {
  const wa = wilson(a.successes, a.n, { confidence });
  const wb = wilson(b.successes, b.n, { confidence });
  if (wa.p === null || wb.p === null) return { diff: null, lower: -1, upper: 1, delta, nonInferior: false };
  const diff = wb.p - wa.p;
  const lower = diff - Math.sqrt((wb.p - wb.lower) ** 2 + (wa.upper - wa.p) ** 2);
  const upper = diff + Math.sqrt((wb.upper - wb.p) ** 2 + (wa.p - wa.lower) ** 2);
  return { diff, lower, upper, delta, nonInferior: lower > -delta };
}

/** Reps per arm to tell p1 from p2: two-sided alpha, unpooled normal approximation. */
function powerN(p1, p2, { alpha = 0.05, power = 0.8 } = {}) {
  if (p1 === p2) return Infinity;
  const za = normInv(1 - alpha / 2);
  const zb = normInv(power);
  return Math.ceil(((za + zb) ** 2) * (p1 * (1 - p1) + p2 * (1 - p2)) / ((p1 - p2) ** 2));
}

module.exports = { normInv, wilson, choose, passHatK, passAtK, pairedSignTest, sprt, sprtPaired, nonInferiority, powerN };
