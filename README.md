# swflcoders


├── Cargo.lock                    # Rust dependency lock file ensuring reproducible builds
├── Cargo.toml                    # Rust project configuration and dependency definitions
├── README.md                     # Project documentation and setup instructions
├── apps
│   └── frontend                  # Main frontend application code and user interface
├── biome.json                    # Code formatting and linting configuration for JavaScript/TypeScript
├── package.json                  # Node.js project metadata and script definitions
├── packages
│   ├── backend                   # Server-side API and business logic implementation
│   ├── cdk                       # AWS Cloud Development Kit infrastructure as code
│   ├── e2e                       # End-to-end testing suite for full application flows
│   ├── frontend.zip              # Packaged frontend application for deployment
│   ├── integ                     # Integration tests for API and service interactions
│   └── types                     # Shared TypeScript type definitions across the project
└── yarn.lock                     # Package manager lock file for consistent dependency versions


Simple example package to show the various parts of a application be deployed via CodePipeline.
