# Selling knowledge to AI agents: strategy

*Status: working draft, September 2026. Market facts come from a research pass on 2026-09-25 with sources listed at the
end. Figures marked [single source] could not be cross-checked. Check them again before quoting them to customers.*

## 1. The idea in one paragraph

Companies that hold specialised knowledge (failure analyses, standards, regulations, price data, playbooks) can sell it
to AI agents **per question, at the moment an agent needs it**, instead of, or on top of, one-off training-data deals.
The agent searches for free, pays a few cents to a few dollars for the document or passage that answers its question,
cites the source, and may not train on it. `paid-mcp-gate` is the toolkit for doing this over MCP. The business is
helping knowledge owners launch and grow this new revenue line.

## 2. Why now

- **MCP is how agents reach tools and data.** Anthropic donated MCP to the Agentic AI Foundation (Linux Foundation)
  in December 2025. At that point it had more than 97M monthly SDK downloads and about 10,000 active servers.
- **Content deals are shifting from one-off training licenses to pay-per-use:**
  - Microsoft launched its Publisher Content Marketplace with usage-based pay in February 2026.
  - Cloudflare moved from "pay per crawl" to **"pay per use"** in July 2026. Publishers are paid when their content powers an answer.
  - Google started a pilot in September 2026 that pays sites when their content shapes AI answers.
  - Reddit is pushing Google for usage-based fees at renewal.
  - Attribution and live-access deals are projected to roughly double, from 18 in 2025 to 34 in 2026.
- **One-off deals do not recur.** Wiley booked $49M of AI revenue in fiscal 2026, but only $8M of it was recurring.
  Per-query sales are recurring by nature, and they grow as agents are used more.
- **Buyers can now pay.** AWS Bedrock AgentCore payments became generally available in August 2026. Enterprise agents
  can pay MCP servers and x402 endpoints from wallets, within spend limits.

## 3. Reality check: what is hard

The idea is sound, but the market is early. A plan that ignores these points will stall.

1. **There is no MCP payment standard.**
   - The proposal to add payments to MCP (SEP-2007) was closed unmerged in June 2026.
   - Two conventions compete: x402 over MCP, and Stripe/Tempo's MPP. They are incompatible.
   - Prepaid accounts with API keys, as in this prototype, work with every MCP client today.
2. **Organic agent-payment demand is still thin.**
   - One analysis put real x402 activity at about $28K a day in March 2026, roughly half of it "gamified" [single source].
   - Cloudflare's pay per crawl was still a private beta a year after launch.
3. **Mainstream assistants do not pay inside MCP calls yet.** No evidence was found that Claude or ChatGPT pay x402 or
   MPP natively. The first buyers are therefore **companies building their own agents**, not consumers.
4. **The paywall itself is being commoditised.**
   - Several platforms sell the paywall as infrastructure: Cloudflare (a Monetization Gateway that explicitly covers
     MCP tools, waitlist only), AWS WAF, Stripe, Zuplo, Kong.
   - A hosted proxy (xpay) charges 5% per tool call.
   - Open-source SDKs such as MCPay and PayMCP are free.
5. **Content leaks once it is delivered.** License terms are contractual, not technical. Controls reduce the risk but
   do not remove it.

**Conclusion: do not sell "a paywall for MCP".** Sell the outcome: *a new, measurable revenue line from know-how the
company already has*. That means knowledge packaged so agents actually buy it, priced sensibly, licensed so the legal
team signs off, and reported so management can see the market. The rails (Stripe, x402, Cloudflare) are tools to plug
in, not competitors to beat.

## 4. Who sells: the target customers

**Ideal customer:** owns knowledge that is *proprietary* (not on the open web), *specialised*, *needed repeatedly at
decision time*, and *accuracy-critical*, so an agent's user pays for authority rather than guessing. The customer has
a small engineering team or none, and already sells the knowledge in some form: subscriptions, reports, consulting or
training.

| Segment | Why agents want it | Notes |
| --- | --- | --- |
| Industrial OEMs, engineering and reliability consultancies | Troubleshooting, failure cases, parts, procedures for maintenance and field-service copilots | The demo vertical. Content is rarely public and mistakes are expensive |
| Standards bodies, certification bodies, trade associations | Compliance agents need the exact clause | They already sell documents, so per-clause pricing is a natural extension |
| Legal, tax and regulatory publishers in smaller languages and jurisdictions | Frontier models are weaker there, and authority matters | Local-language content is underserved by the large AI licensing deals |
| Market, price and benchmark data firms | Procurement, estimating and pricing agents | Highest value per query. Price them like the benchmark in the demo |
| Niche B2B research and trade press | Research agents want current, expert analysis | Fresh content and archives |
| Clinical or medical reference publishers | High value | Heavy regulation. Later, with specialist legal advice |

**Avoid:** content that is already free online, fast-commoditising general knowledge, and anything with personal data.

### Qualifying a prospect: seven questions

1. Is the knowledge unique, or can an agent find an equivalent free on the web?
2. Is it needed repeatedly, at the moment of a decision (diagnosing, complying, pricing, choosing)?
3. Does a wrong answer cost the user real money or create liability?
4. Is it in a form we can ingest (documents, HTML, PDF, a database)?
5. Does the company own the rights? Check authors, contributors, and client confidentiality in case studies.
6. Will it set per-use prices and license terms, or does every deal need a committee?
7. Can we name at least three agent builders in its vertical who would pay?

## 5. Who buys

- **Vertical agent builders** (maintenance copilots, legal assistants, procurement agents). They need authoritative,
  citable answers and cannot afford hallucinations. They are the first buyers and pay from prepaid accounts.
- **Enterprise agent platforms**, for example on AWS Bedrock AgentCore, which can pay per call within spend limits.
  This is where keyless x402 payment matters (roadmap).
- **AI platforms, through platform-pays deals.** PitchBook's MCP integration in Perplexity gives non-subscribers limited
  data, and Perplexity or the enterprise partner pays PitchBook. This is later, once a publisher has traction.

**What buyers pay for:** accuracy and provenance (citations), freshness, clear rights (a license on every response),
and cost (pay per use instead of a full enterprise subscription for occasional questions).

**Where to find them:** the publisher's own customers who are building AI features (the warmest leads), agent-builder
communities in the vertical, AWS Marketplace, and agent-payment directories such as Coinbase's x402 Bazaar and
Agentic.Market.

## 6. The product

What exists in this repository (see the [README](../README.md)):

- Free search with publisher-controlled teasers, match quality and prices.
- Paid access per document or per passage, from prepaid accounts.
- A license and citation on every delivery, with the buyer's account and receipt attached.
- Buyer safety: per-call price caps, daily spend caps, and free re-reads for 24 hours.
- Publisher safety: bulk-export limits, rate limits, hashed keys, and an append-only ledger.
- A publisher dashboard: revenue, best sellers, buyers, paywall hits, and **unmet demand**, meaning the questions
  agents asked that the knowledge base could not answer.

The unmet-demand report deserves emphasis in sales conversations. Even before revenue arrives, it tells a publisher
what the AI market is asking for. That is editorial and product intelligence that no one else can give them.

Roadmap, in the order customers are likely to ask for it: self-serve Stripe top-ups and invoices; subscriber
passthrough (how LSEG, FactSet and S&P expose data over MCP today, so the new channel does not cannibalise existing
subscriptions); keyless x402 pay-per-call, then MPP; OAuth 2.1; connectors for SharePoint, Confluence and databases,
with hybrid search; RSL-aligned license metadata and Web Bot Auth pricing for verified agents; a proxy mode that meters
an existing MCP server; the MCP 2026-07-28 spec; and leak deterrence.

## 7. How we make money

| Model | What the customer gets | Price hypothesis to test |
| --- | --- | --- |
| **Launch package** (done for you) | Content and rights audit, packaging and teasers, pricing and license terms, deployment, registry listings, onboarding the first buyers | Fixed fee, roughly €8k–25k depending on corpus size and integrations |
| **Managed service** | Hosting, billing, updates, monthly demand report, buyer onboarding | Monthly fee plus a **15–25% revenue share** |
| **Open-source core** (this repo, MIT) | Credibility, lead generation, community fixes | Free |

For reference, other businesses take these shares: a thin proxy charges 5% (xpay), Apify's store keeps about 20%,
ProRata splits 50/50 with publishers, and app stores take 15–30%. A full managed service that also finds buyers
justifies a larger share than a thin proxy.

**Expect setup fees to dominate year one.** Per-query volume starts small, so the revenue share is the long-term upside,
not the plan for paying the bills. Do not build a two-sided marketplace until about ten publishers are live: a
marketplace with no supply cannot attract buyers.

## 8. Pricing guidance for publishers

- **Benchmarks:**
  - Commodity agent web search costs about $1–8 per 1,000 queries (Parallel, Brave, Perplexity, Exa, Tavily), which
    is $0.001–0.008 per query.
  - A survey of priced x402 routes found a median of about $0.02 per call [single source].
  - The demo prices of $0.05–$1.50 per document sit one to two orders of magnitude above commodity search. That gap
    is justified only for proprietary, expert content.
- **Keep search free.** Discovery drives purchases, and every free query is demand data.
- **Price by uniqueness and value:** proprietary data and benchmarks highest, case studies in the middle, how-to guides
  lowest. Passages cost a fraction of their document's price.
- **Be generous where it builds trust:** free re-reads within 24 hours, price caps per call, and teasers that sell
  without spoiling the answer.
- **Use caps to sell bulk licenses.** The daily limit on new documents turns "download everything" into a sales
  conversation instead of a leak.
- **Use prepaid credits, not per-call card charges.** Card fees make charges under $1 uneconomic on their own; the
  market is moving to prepaid balances too.
- **Later:** separate prices for verified agents (Web Bot Auth) and for anonymous ones. An AWS reference sample
  illustrates a 10× gap.

## 9. The first 90 days

**Weeks 1–2: focus.**
- Pick one vertical where you have access and credibility.
- List 30 knowledge owners and 15 agent builders in it.
- Record a 3-minute demo (`npm run demo` plus the dashboard). The demo is the pitch.

**Weeks 3–6: design partners.**
- Land two or three publishers at a discounted setup fee, in exchange for a case study and their data.
- Deploy on their real content, about a week each.
- Build the two roadmap items they ask for first. Probably Stripe top-ups and subscriber passthrough.

**Weeks 7–12: first real money.**
- Get at least one buyer paying real money.
- Publish the case study: searches, paywall hits, revenue, and content gaps found.
- Convert the pipeline to paid launch packages and fix your prices from what you learned.

**Metrics to watch:**
- Publishers live.
- Paying buyers.
- Paid deliveries per week.
- Revenue per 1,000 searches.
- Paywall-to-purchase conversion.
- Content gaps the publisher chose to fill.

## 10. The pitch

> AI agents are becoming your readers. Today they either cannot reach your knowledge, so they guess, or they take it
> without paying. We turn your knowledge base into a paid, AI-ready service in weeks. Agents search it for free, pay
> per answer, cite you, and are not licensed to train on it. You keep your content, set your prices, protect your
> existing subscriptions, and see exactly what the AI market is asking for, including the questions you cannot
> answer yet.

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Agent-payment demand stays thin for longer | Sell prepaid credits to named agent builders; price the setup and analytics value, not only the revenue share |
| Big platforms bundle "good enough" paywalls | Do not compete on payment rails; integrate them. Own packaging, licensing, analytics and buyer onboarding |
| Payment conventions fragment | Keep rails pluggable. Prepaid credits work with every MCP client; add x402 and MPP behind the same gate |
| Bought content is used for training or resold | Controlled teasers, passage-level sales, a license and licensee on every response, daily caps, bulk licenses, contracts with named buyers, canaries (roadmap) |
| Protocol churn (for example the 2026-07-28 spec) | The stateless design already matches where MCP is going; keep the SDK current |
| Rights and liability | Rights audit during onboarding, disclaimers, license text reviewed by counsel |
| Tax on cross-border digital sales (for example EU VAT) | Use a payment provider's tax tooling or a merchant of record; take accounting advice before selling credits abroad |

## 12. Open questions to decide together

1. Which vertical, and which three knowledge owners, can we reach first?
2. Will buyers accept prepaid accounts, or do they need invoices or marketplace billing (AWS Marketplace)?
3. Do we stay services-led, or aim for a hosted product within a year?
4. Which license terms will a publisher's lawyers accept, and does aligning with RSL help?

## Sources

- MCP spec 2026-07-28 and release candidate: <https://blog.modelcontextprotocol.io/posts/2026-07-28/>, <https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/>
- MCP joins the Agentic AI Foundation (2025-12-09): <https://blog.modelcontextprotocol.io/posts/2025-12-09-mcp-joins-agentic-ai-foundation/>
- SEP-2007 MCP payments proposal, closed 2026-06-24: <https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2007>
- x402 MCP transport spec: <https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/mcp.md>
- x402 demand analysis (CoinDesk, 2026-03-11): <https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet>
- AWS Bedrock AgentCore payments GA (2026-08-18): <https://aws.amazon.com/about-aws/whats-new/2026/08/bedrock-agentcore-payments-ga/>
- Stripe Machine Payments Protocol (2026-03-18): <https://stripe.com/blog/machine-payments-protocol>
- Cloudflare pay per use (2026-07-01): <https://techcrunch.com/2026/07/01/cloudflares-new-policy-pushes-ai-companies-to-pay-for-publishers-content/>
- Cloudflare Monetization Gateway: <https://blog.cloudflare.com/monetization-gateway/>
- Microsoft Publisher Content Marketplace (2026-02): <https://searchengineland.com/microsoft-launches-publisher-content-marketplace-for-ai-licensing-468191>
- Google AI contribution pilot (2026-09-17): <https://9to5google.com/2026/09/17/google-ai-contribution-pilot-tests-paying-websites-when-theyre-used-in-ai-results/>
- Reddit and Google renewal (2026-07-22): <https://www.cnbc.com/2026/07/22/reddit-stock-google-ai-content-deal.html>
- Wiley fiscal 2026 results: <https://newsroom.wiley.com/press-releases/press-release-details/2026/Research-and-AI-Momentum-Record-Margins-and-Cash-Flow-Growth-Highlight-Wileys-Fourth-Quarter-and-Fiscal-2026-Results/default.aspx>
- AI licensing deal count (2026-06-03): <https://mediaandthemachine.substack.com/p/ai-content-licensing-deals-june-2026>
- RSL 1.0 standard (2025-12-10): <https://www.globenewswire.com/news-release/2025/12/10/3203217/0/en/rsl-ai-licensing-1-0-now-an-official-industry-standard-with-new-capabilities-as-momentum-accelerates.html>
- PitchBook in Perplexity (2026-03-12): <https://www.businesswire.com/news/home/20260312253855/en/PitchBook-Announces-New-Essential-MCP-Integration-with-Perplexity-Expanding-Access-to-AI-Powered-Verifiable-Market-Intelligence>
- LSEG and Anthropic (2025-10-27): <https://www.lseg.com/en/media-centre/press-releases/2025/lseg-announces-collaboration-with-anthropic>
- xpay MCP monetization: <https://docs.xpay.sh/en/products/mcp-monetization>
- Apify pay-per-event: <https://docs.apify.com/platform/actors/publishing/monetize/pay-per-event>
- ProRata Series B and 50/50 split (2025-09-05): <https://www.businesswire.com/news/home/20250905771340/en/ProRata-Closes-$40-Million-Series-B-Financing-and-Launches-Gist-Answers-Creating-New-Revenue-Opportunities-for-Publishers-in-the-AI-Era>
- Search API prices: <https://parallel.ai/products/search>, <https://docs.perplexity.ai/docs/getting-started/pricing>, <https://docs.tavily.com/documentation/api-credits>
- x402 pricing survey [single source]: <https://theaicareerlab.com/blog/x402-pricing-report-2026>
