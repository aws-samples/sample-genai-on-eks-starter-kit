"use client";

import { Card } from "../Card";
import { ServiceMap } from "../ServiceMap";

/**
 * East-west connectivity. Full-bleed because the map needs the horizontal room:
 * services are laid out left to right in call order.
 */
export function ServiceMapSection() {
  return (
    <Card
      title="Service-to-service connectivity"
      subtitle="Edges are calls between services, from Beyla's service-graph metrics. Direction runs left to right; colour is error rate, thickness is request volume. Filter by namespace, service, AZ, CPU architecture, GPU type or worker node; hover an edge for its numbers, or a node to isolate its calls."
    >
      <ServiceMap />
    </Card>
  );
}
