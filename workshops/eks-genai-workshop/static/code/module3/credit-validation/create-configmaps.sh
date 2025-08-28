kubectl config set-context --current --namespace=workshop

kubectl create configmap loan-buddy-agent --from-file=./credit-underwriting-agent.py 

kubectl create configmap mcp-address-validator --from-file=./mcp-address-validator.py 

kubectl create configmap mcp-employment-validator --from-file=./mcp-income-employment-validator.py 

kubectl create configmap mcp-image-processor --from-file=./mcp-image-processor.py 