# GPU Hunter 🎯

A Go CLI tool that discovers GPU and Neuron instance availability across AWS regions, showing pricing, spot interruption rates, and spot placement scores.

**Inspired by [Karpenter](https://github.com/aws/karpenter-provider-aws)'s instance type discovery capabilities and [spotinfo](https://github.com/alexei-led/spotinfo)'s spot advisor integration.**

## Features

- 🔍 **Discover GPU instances** - Find all NVIDIA, AMD, and Habana GPU instance types
- 🧠 **Discover Neuron instances** - Find all AWS Inferentia and Trainium instance types
- 🌍 **Multi-region support** - Query multiple regions in parallel
- 💰 **Pricing information** - Show spot and on-demand prices
- 📊 **Spot placement scores** - Indicate likelihood of getting spot capacity (1-10 scale)
- ⚡ **Interruption rates** - Show historical spot interruption frequency from AWS Spot Advisor
- 💵 **Savings percentage** - Show savings vs on-demand pricing
- 🔄 **Flexible sorting** - Sort by price, score, interruption rate, or savings
- 🎯 **Score filtering** - Filter by minimum spot placement score
- 📋 **Multiple output formats** - Table or JSON output
- 🖥️ **Interactive TUI** - terminal interface for browsing instances

## Requirements

- Go 1.21+
- AWS credentials configured (via environment variables, ~/.aws/credentials, or IAM role if deploying on EC2)
- Required IAM permissions:
  - `ec2:DescribeInstanceTypes`
  - `ec2:DescribeInstanceTypeOfferings`
  - `ec2:DescribeSpotPriceHistory`
  - `ec2:GetSpotPlacementScores`
  - `ec2:DescribeRegions`
  - `pricing:GetProducts`
  - For probe command only:
    - `ec2:RunInstances`
    - `ec2:TerminateInstances`
    - `ec2:DescribeImages`
    - `ec2:DescribeSubnets`
    - `ec2:CreateTags`

Currently everything is either Spot or On Demand
Savings Plan
Capacity Block
Private Pricing View

## Installation

```bash
# Clone the repository
cd gpu-hunter

go mod tidy

# Build the binary
go build -o gpu-hunter ./cmd/gpu-hunter
```

## Usage

### Basic Usage

```bash
# Hunt for all accelerator instances in default regions
./gpu-hunter

# Hunt for GPU instances only
./gpu-hunter --type gpu

# Hunt for Neuron instances only
./gpu-hunter --type neuron
```

### Spot Placement Scores

```bash
# Include spot placement scores (indicates likelihood of getting spot capacity)
./gpu-hunter --spot-score

# Filter by minimum score (only show instances with score >= 7)
./gpu-hunter --spot-score --min-score 7

# Note: This makes additional API calls and is slower
```

### Sorting Options

```bash
# Sort by spot price (ascending)
./gpu-hunter --sort price

# Sort by spot placement score (descending)
./gpu-hunter --spot-score --sort score

# Sort by interruption rate (ascending - lower is better)
./gpu-hunter --sort interruption

# Sort by savings percentage (descending)
./gpu-hunter --sort savings

# Default: sort by instance name
./gpu-hunter --sort name
```

### Region Selection

```bash
# Specific regions
./gpu-hunter --regions us-east-1,us-west-2,eu-west-1

# All enabled regions (slower)
./gpu-hunter --all-regions
```

### Filtering

```bash
# Filter by GPU manufacturer
./gpu-hunter --manufacturer nvidia
./gpu-hunter --manufacturer amd
./gpu-hunter --manufacturer habana

# Filter by minimum spot score
./gpu-hunter --spot-score --min-score 7
```

### Output Formats

```bash
# Table output (default)
./gpu-hunter --output table

# JSON output
./gpu-hunter --output json
```

### Full Example

```bash
# Hunt for NVIDIA GPUs in US regions with spot scores, sorted by price
./gpu-hunter \
  --regions us-east-1,us-east-2,us-west-2 \
  --type gpu \
  --manufacturer nvidia \
  --spot-score \
  --sort price \
  --output table
```

### Interactive TUI Mode

Launch an interactive terminal interface for browsing GPU instances:

```bash
# Launch TUI with default region (us-east-1)
./gpu-hunter tui

# Launch TUI with specific region
./gpu-hunter tui --region us-west-2

# Launch TUI with spot placement scores
./gpu-hunter tui --spot-score
```

#### TUI Keyboard Shortcuts

**Navigation**
| Key | Action |
|-----|--------|
| `↑/k` | Move up |
| `↓/j` | Move down |
| `PgUp/Ctrl+U` | Page up |
| `PgDn/Ctrl+D` | Page down |
| `g/Home` | Go to top |
| `G/End` | Go to bottom |
| `Enter` | View instance details |
| `Esc` | Back / Cancel |

**Filtering**
| Key | Action |
|-----|--------|
| `/` | Open filter input |
| `Tab` | Cycle filter column (All/Instance/Accelerator/Manufacturer/Type) |
| `Ctrl+U` | Clear filter |
| `t` | Toggle GPU/Neuron/All |
| `1` | NVIDIA only |
| `2` | AMD only |
| `0` | All manufacturers |

**Sorting**
| Key | Action |
|-----|--------|
| `s` | Cycle sort column |
| `d` | Toggle sort direction (ascending/descending) |
| `P` | Sort by price |
| `S` | Sort by spot score |
| `I` | Sort by interruption rate |
| `$` | Sort by savings |
| `N` | Sort by name |

**Display**
| Key | Action |
|-----|--------|
| `r` | Select region |
| `w` | Toggle wide mode |
| `c` | Toggle spot scores |
| `l` | Lookup instance across all regions |
| `p` | Probe instance capacity across regions |
| `R` | Refresh data |
| `?` | Show help |
| `Esc` | Return to main menu |
| `q` | Quit |

#### TUI Features

- **Main Menu at Startup**: The TUI starts with a main menu offering three options:
  - **Browse by Region**: Select a region and explore all GPU/Neuron instances
  - **Lookup Instance**: Search for a specific instance type across all regions
  - **Probe Capacity**: Test actual capacity by launching instances
- **Quick Navigation**: Press `Esc` from any view to return to the main menu
- **Spot Scores Shown by Default**: Spot placement scores are displayed by default in the table
- **Column-Specific Filtering**: Press `/` to filter, then `Tab` to cycle through filter columns (All, Instance Type, Accelerator, Manufacturer, Type)
- **Sort Direction Toggle**: Press `d` to toggle between ascending (▲) and descending (▼) sort order
- **Visual Sort Indicator**: The status bar shows the current sort column and direction (e.g., `Sort: Price ▲`)
- **Global Instance Lookup**: Press `l` on any instance to see its availability, pricing, and spot scores across all AWS regions
- **Capacity Probing**: Press `p` on any instance to probe its capacity across all available regions

### Lookup Command

Look up a specific instance type across all AWS regions to compare pricing and availability:

```bash
# Lookup an instance type across all regions
./gpu-hunter lookup g4dn.xlarge

# Lookup with spot placement scores (slower but more data)
./gpu-hunter lookup p4d.24xlarge --spot-score

# Lookup specific regions only
./gpu-hunter lookup g5.xlarge --regions us-east-1,us-west-2,eu-west-1
```

The lookup command shows:
- Instance specifications (GPU/Neuron type, count, memory, vCPU)
- Best region for spot pricing (highlighted)
- Per-region breakdown: spot price, on-demand price, savings %, interruption rate, zone count, spot score
- Summary of availability across queried regions

**TUI Lookup**: In the TUI, press `l` on any selected instance to perform a lookup across all regions. Use `↑↓` to navigate the results and `ESC` to return to the main table.

## Sample Output

```
🔍 Hunting for accelerator instances in 3 regions...
✓ Fetched spot interruption data from AWS Spot Advisor
✓ us-east-1: found 45 accelerator instance types
✓ us-west-2: found 42 accelerator instance types
✓ us-east-2: found 38 accelerator instance types

📍 Region: us-east-1
============================================================================================================
Instance Type    Type    Accelerator         Count    Memory    Zones    Interrupt    Spot $/hr    OD $/hr    Savings    Score
g5.xlarge        GPU     a10g (nvidia)       1        24 GB     6        <5%          $0.42        $1.01      58%        9/10
g6.xlarge        GPU     l4 (nvidia)         1        24 GB     6        <5%          $0.35        $0.85      59%        9/10
p4d.24xlarge     GPU     a100 (nvidia)       8        320 GB    6        5-10%        $12.45       $32.77     62%        7/10
p5.48xlarge      GPU     h100 (nvidia)       8        640 GB    4        10-15%       $25.00       $98.32     75%        4/10
inf2.xlarge      Neuron  inferentia2         1        32 GB     4        <5%          $0.38        $0.76      50%        8/10
trn1.32xlarge    Neuron  trainium            16       512 GB    2        5-10%        $8.50        $21.50     60%        6/10

📊 Summary: 35 GPU types, 10 Neuron types
```

## CLI Flags Reference

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--regions` | `-r` | GPU-heavy regions | AWS regions to check (comma-separated) |
| `--output` | `-o` | `table` | Output format: `table`, `json` |
| `--type` | `-t` | `all` | Accelerator type: `gpu`, `neuron`, `all` |
| `--pricing` | `-p` | `true` | Show pricing information |
| `--spot-score` | `-s` | `false` | Show spot placement scores (slower) |
| `--all-regions` | `-a` | `false` | Check all enabled AWS regions |
| `--manufacturer` | `-m` | | Filter by GPU manufacturer: `nvidia`, `amd`, `habana` |
| `--sort` | | `name` | Sort by: `name`, `price`, `score`, `interruption`, `savings` |
| `--min-score` | | `0` | Filter by minimum spot placement score (1-10) |

### Lookup Command Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--regions` | `-r` | All regions | AWS regions to check (comma-separated) |
| `--spot-score` | `-s` | `false` | Include spot placement scores |
| `--output` | `-o` | `table` | Output format: `table`, `json` |

## Understanding the Data

### Spot Placement Score (1-10)

The spot placement score indicates the likelihood of successfully launching spot instances:

| Score | Likelihood | Description |
|-------|------------|-------------|
| 8-10  | High       | Excellent chance of getting the requested capacity |
| 5-7   | Medium     | Reasonable chance but may face some constraints |
| 1-4   | Low        | Difficult to get the full capacity, consider alternatives |

### Interruption Rate

The interruption rate shows historical frequency of spot instance interruptions from AWS Spot Advisor:

| Range | Description |
|-------|-------------|
| `<5%` | Very low interruption frequency - most stable |
| `5-10%` | Low interruption frequency |
| `10-15%` | Moderate interruption frequency |
| `15-20%` | Higher interruption frequency |
| `>20%` | High interruption frequency - least stable |

### Savings Percentage

The savings percentage shows how much cheaper spot pricing is compared to on-demand pricing for that instance type.

### Probe Command (Capacity Verification)

> **WARNING:** The probe command launches real EC2 instances. You may incur costs and must have sufficient service quotas.

Probe tests **actual** capacity availability by launching instances and immediately terminating them. Unlike spot placement scores (which are probabilistic), this provides definitive proof that capacity can be provisioned.

```bash
# Probe spot capacity for a specific instance type
./gpu-hunter probe g5.xlarge --capacity spot

# Probe on-demand capacity
./gpu-hunter probe g5.xlarge --capacity on-demand

# Probe both spot and on-demand
./gpu-hunter probe p4d.24xlarge --capacity both

# Probe across specific regions
./gpu-hunter probe g6.xlarge --capacity spot --regions us-east-1,us-west-2

# Probe all available regions for an instance type
./gpu-hunter probe g5.xlarge --capacity spot --all-regions

# Preview what would be probed without launching
./gpu-hunter probe g5.xlarge --capacity spot --all-regions --dry-run
```

#### Probe Command Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--capacity` | `-c` | `spot` | Capacity type: `spot`, `on-demand`, `both` |
| `--regions` | `-r` | us-east-1 | Regions to probe (comma-separated) |
| `--all-regions` | `-a` | `false` | Probe all regions where instance is available |
| `--output` | `-o` | `table` | Output format: `table`, `json` |
| `--concurrency` | | `5` | Maximum concurrent probes |
| `--dry-run` | | `false` | Show what would be probed without launching |

#### Probe Requirements

- **IAM Permissions:**
  - `ec2:RunInstances` - Launch test instances
  - `ec2:TerminateInstances` - Clean up test instances
  - `ec2:DescribeImages` - Find AMI for launch
  - `ec2:DescribeSubnets` - Find subnet for launch
  - `ec2:CreateTags` - Tag instances (for cleanup identification)
- **Account Requirements:**
  - Default VPC must exist in target regions
  - Sufficient service quotas for the instance types being probed
  - Spot service-linked role (for spot probes)

#### Cost Considerations

- **Instance charges:** Probes launch actual instances. You pay for the few seconds each instance runs (minimum 60 seconds billing).
- **Spot pricing:** Spot probes are charged at the current spot price for those seconds.
- **Typical cost:** A single probe typically costs less than $0.01-$0.10 depending on instance type.
- **Failed launches:** No cost for launches that fail due to capacity/quota issues.

#### Probe Error Codes

| Error Code | Meaning | Resolution |
|------------|---------|------------|
| `InsufficientInstanceCapacity` | No capacity available | Try different zone or wait |
| `MaxSpotInstanceCountExceeded` | Spot quota exceeded | Request quota increase |
| `VcpuLimitExceeded` | vCPU quota exceeded | Request quota increase |
| `InstanceLimitExceeded` | Instance limit exceeded | Request quota increase |
| `UnfulfillableCapacity` | Generic capacity issue | Try different instance type |
| `UnauthorizedOperation` | IAM permission denied | Check IAM policy |
| `AuthFailure.ServiceLinkedRoleCreationNotPermitted` | Spot SLR not created | Create Spot service-linked role |

## Data Sources

| Data | Source | Description |
|------|--------|-------------|
| Instance Types | `DescribeInstanceTypes` API | GPU/Neuron specs, vCPU, memory |
| Zone Availability | `DescribeInstanceTypeOfferings` API | Availability per zone |
| Spot Pricing | `DescribeSpotPriceHistory` API | Current spot prices |
| On-Demand Pricing | `GetProducts` (Pricing API) | On-demand prices |
| Spot Placement Score | `GetSpotPlacementScores` API | Spot capacity likelihood |
| Interruption Rate | [AWS Spot Advisor](https://spot-bid-advisor.s3.amazonaws.com/spot-advisor-data.json) | Historical interruption data |

## Architecture

```
gpu-hunter/
├── cmd/
│   └── gpu-hunter/
│       ├── main.go              # CLI entry point
│       ├── lookup.go            # Lookup command
│       ├── probe.go             # Probe command
│       └── tui.go               # TUI command
├── pkg/
│   ├── aws/
│   │   └── client.go            # AWS SDK client setup
│   ├── models/
│   │   ├── gpu.go               # Instance type data models
│   │   └── probe.go             # Probe request/result models
│   ├── tui/
│   │   ├── app.go               # TUI application logic
│   │   ├── model.go             # TUI state management
│   │   ├── keys.go              # Keyboard bindings
│   │   └── styles.go            # TUI styling
│   └── providers/
│       ├── instancetype/
│       │   └── provider.go      # Instance type discovery
│       ├── pricing/
│       │   └── provider.go      # Spot & on-demand pricing
│       ├── spotplacement/
│       │   └── provider.go      # Spot placement scores
│       ├── interruption/
│       │   └── provider.go      # Spot interruption rates
│       ├── lookup/
│       │   └── provider.go      # Multi-region instance lookup
│       └── probe/
│           └── provider.go      # Capacity probing (launch & terminate)
├── go.mod
└── README.md
```

## Credits

This project extracts and adapts code from:

- [Karpenter Provider AWS](https://github.com/aws/karpenter-provider-aws) - Instance type discovery, GPU/Neuron detection, pricing provider
- [spotinfo](https://github.com/alexei-led/spotinfo) - Spot Advisor integration for interruption rates