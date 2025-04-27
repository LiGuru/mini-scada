# AIT System Demo – Project Overview and Requirements

## 1. Purpose

This document defines the architecture, concepts, and requirements of the AIT (Assembly, Integration, Testing) Demo System. It summarizes the agreed approaches, explains the rationale behind the design choices, and captures the results of our PoC experiments.

The focus is on clear separation of roles between orchestration logic, execution agents, and hardware. The system is designed to be flexible, scalable, and compatible with real-world workflows, where hardware readiness is controlled locally and execution logic is centralized.

---

## 2. Architecture and Layers

### High-Level Concept

The system is split into four layers:

| Layer              | Responsibility                                    |
|--------------------|----------------------------------------------------|
| **Business**       | Campaign management, user control, test definitions |
| **Orchestration**  | Test dispatching, monitoring, queue management      |
| **Execution**      | Physical test execution on the test bench          |
| **Hardware**       | Measurement equipment, DUT (Device Under Test), relays, matrices |

---

### Controlled Pull Model (Operator-Driven Readiness)

- Execution agents never start tasks unless explicitly **ready**.
- Orchestration prepares tasks, but agents **pull** them when they are ready.
- Prevents accidental triggering of tests on disconnected hardware.
- Supports human-in-the-loop or robotic readiness signaling.

---

## 3. Design Principles

| Principle     | Meaning                                         |
|---------------|-------------------------------------------------|
| KISS          | Keep It Simple and Stable                       |
| DRY           | Don’t Repeat Yourself (reusable logic)          |
| YAGNI         | You Aren’t Gonna Need It (avoid premature features) |
| Separation of Concerns | Strict layer responsibilities           |

---

## 4. Communication Model

| Use Case               | Mechanism               | Note                                |
|------------------------|------------------------|--------------------------------------|
| Task assignment         | RabbitMQ direct exchange | Task sent only to the right agent   |
| Execution result reporting | RabbitMQ direct exchange | Reports results back to orchestrator |
| Agent status (heartbeat) | RabbitMQ direct exchange | Ready / Busy / In process / Error   |
| Abort mechanism          | RabbitMQ direct exchange | Stop execution if needed           |
| GUI communication        | RabbitMQ (separate queues per GUI instance) | No direct access to orchestration logic |

---

## 5. Proof-of-Concept (PoC) Summary

| Component     | PoC Goal                                  | Status                  |
|---------------|--------------------------------------------|------------------------|
| Orchestrator  | Sends tasks, tracks status, abort logic    | Implemented, working    |
| Executor      | Executes received tasks, sends results     | Implemented, working    |
| GUI (Electron)| Shows status, results, supports kiosk mode | Initial PoC ready       |

Key concepts tested:
- Pull-based readiness.
- RabbitMQ queues for decoupled communication.
- Abort handling and task dependencies.
- Task tracking via task IDs and persistence in files.

---

## 6. Requirements Breakdown (Prioritized)

| Priority | Requirement                                     | Status           |
|----------|-------------------------------------------------|------------------|
| High     | Operator-driven readiness                       | In place         |
| High     | Task queue with persistence                     | Working, file-based |
| High     | Abort logic                                      | Implemented      |
| Medium   | GUI showing status and results                   | Initial PoC done |
| Medium   | Task dependencies (no next task if failure)      | Implemented in PoC |
| Medium   | Reporting with templates and formulas           | Concept defined  |
| Low      | MES/ERP integration (future-proof interfaces)    | Open             |

---

## 7. HW/SW Version Tracking Concept

| Challenge                                 | Solution                                         |
|--------------------------------------------|-------------------------------------------------|
| Modules can’t self-report version reliably| Add manual entry fields: reported, assumed, verified |
| Track version metadata alongside test logs| Supports auditability and traceability           |
| Differentiate between official releases and local mods | Operator notes, metadata fields                 |

---

## 8. Reporting and Template Handling

- Templates defined in Excel.
- Zones marked via **comments**: `header:range(...)`, `data:range(...)`, `summary:range(...)`, `footer:range(...)`.
- Data expressions supported: e.g., `{device.attributes.speed($value > 5.0)}`.
- Backend fills templates dynamically while preserving formulas.

---

## 9. Open Questions / Future Considerations

| Topic                   | Open Question                            |
|-------------------------|------------------------------------------|
| MES/ERP connection      | Will there be an official API?           |
| Test definition storage | Continue with files or move to DB?       |
| Report version control  | How to track changes to templates?       |
| Scalability             | Multi-agent scenarios and queue scaling? |

---

## 10. Collaboration Guidelines

- All architecture discussions tracked through README updates.
- Separate repos (or folders) for Orchestrator, Executor, GUI.
- Clear version tagging of each working snapshot.
- Small iterations and one focus area per update.

---

> This document is a living artifact. Changes will be reflected here as the project evolves.
