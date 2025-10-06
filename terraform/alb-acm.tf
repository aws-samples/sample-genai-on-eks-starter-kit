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
