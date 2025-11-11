from guardrails.hub import DetectPII
from guardrails import Guard

guard = Guard()
guard.name = "detect-pii"
guard.use(DetectPII(pii_entities=["EMAIL_ADDRESS", "IP_ADDRESS"], on_fail="fix"))
