resource "aws_acm_certificate" "wildcard" {
  count                     = var.domain != "" ? 1 : 0
  domain_name               = "*.${var.domain}"
  validation_method         = "DNS"
  subject_alternative_names = ["${var.domain}"]
  lifecycle {
    create_before_destroy = true
  }
}

data "aws_route53_zone" "selected" {
  count        = var.domain != "" ? 1 : 0
  name         = var.domain
  private_zone = false
}

resource "aws_route53_record" "validation" {
  for_each = var.domain != "" ? {
    for dvo in aws_acm_certificate.wildcard[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}
  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.selected[0].zone_id
}

resource "aws_acm_certificate_validation" "wildcard" {
  count                   = var.domain != "" ? 1 : 0
  certificate_arn         = aws_acm_certificate.wildcard[0].arn
  validation_record_fqdns = [for record in aws_route53_record.validation : record.fqdn]
}

resource "kubectl_manifest" "ingressclassparams_shared_internet_facing_alb" {
  count     = var.domain != "" ? 1 : 0
  yaml_body = <<-YAML
apiVersion: eks.amazonaws.com/v1
kind: IngressClassParams
metadata:
  name: shared-internet-facing-alb
spec:
  scheme: internet-facing
  group:
    name: shared-internet-facing-alb
  YAML

  depends_on = [module.eks_blueprints_addons_core]
}

resource "kubectl_manifest" "ingressclass_shared_internet_facing_alb" {
  count     = var.domain != "" ? 1 : 0
  yaml_body = <<-YAML
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"
  name: shared-internet-facing-alb
spec:
  controller: eks.amazonaws.com/alb
  parameters:
    apiGroup: eks.amazonaws.com
    kind: IngressClassParams
    name: shared-internet-facing-alb
  YAML

  depends_on = [kubectl_manifest.ingressclassparams_shared_internet_facing_alb]
}


resource "kubectl_manifest" "ingress_internet_facing_alb" {
  count     = var.domain != "" ? 1 : 0
  yaml_body = <<-YAML
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: default
  namespace: default
  annotations:
    alb.ingress.kubernetes.io/group.order: "1000"
    alb.ingress.kubernetes.io/target-type: ip
spec:
  ingressClassName: shared-internet-facing-alb
  defaultBackend:
    service:
      name: default
      port:
        number: 80
  YAML

  depends_on = [kubectl_manifest.ingressclass_shared_internet_facing_alb]
}

resource "kubectl_manifest" "ingressclassparams_internet_facing_alb" {
  count     = var.domain == "" ? 1 : 0
  yaml_body = <<-YAML
apiVersion: eks.amazonaws.com/v1
kind: IngressClassParams
metadata:
  name: internet-facing-alb
spec:
  scheme: internet-facing
  YAML

  depends_on = [module.eks_blueprints_addons_core]
}

resource "kubectl_manifest" "ingressclass_internet_facing_alb" {
  count = var.domain == "" ? 1 : 0

  yaml_body = <<-YAML
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"
  name: internet-facing-alb
spec:
  controller: eks.amazonaws.com/alb
  parameters:
    apiGroup: eks.amazonaws.com
    kind: IngressClassParams
    name: internet-facing-alb
  YAML

  depends_on = [kubectl_manifest.ingressclassparams_internet_facing_alb]
}
