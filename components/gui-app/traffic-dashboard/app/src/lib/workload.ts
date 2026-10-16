/**
 * Derives a workload ("service") name from a pod name.
 *
 * DCGM's series carry only namespace/pod/container, so attributing GPU usage to
 * a service means stripping the generated suffixes Kubernetes appends. This is a
 * heuristic on a naming convention, not an owner-reference lookup — a pod whose
 * own name ends in something that looks like a hash will be over-trimmed.
 */

/** Deployment → ReplicaSet → Pod: "<name>-<rs hash>-<pod suffix>". */
const DEPLOYMENT_POD = /^(.*?)-[a-f0-9]{6,10}-[a-z0-9]{5}$/;
/** StatefulSet / indexed Job: "<name>-<ordinal>". */
const ORDINAL_POD = /^(.*?)-[0-9]+$/;
/** Bare ReplicaSet or DaemonSet pod: "<name>-<5-char suffix>". */
const SUFFIX_POD = /^(.*?)-[a-z0-9]{5}$/;

export function workloadFromPod(pod: string): string {
  if (!pod) return "unknown";
  for (const pattern of [DEPLOYMENT_POD, ORDINAL_POD, SUFFIX_POD]) {
    const match = pattern.exec(pod);
    if (match?.[1]) return match[1];
  }
  return pod;
}
