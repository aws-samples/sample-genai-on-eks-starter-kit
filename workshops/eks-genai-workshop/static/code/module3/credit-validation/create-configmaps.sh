kubectl create configmap loan-buddy-agent --from-file=./credit-underwriting-agent.py -n NSNAME

kubectl create configmap mcp-address-validator --from-file=./mcp-address-validator.py -n NSNAME

kubectl create configmap mcp-employment-validator --from-file=./mcp-income-employment-validator.py -n NSNAME

kubectl create configmap mcp-image-processor --from-file=./mcp-image-processor.py -n NSNAME