
(() => {
    "use strict";

    // Use your deployed API URL.
    // For local testing, use "http://127.0.0.1:8000" instead.
    const API_BASE = "https://mansik-santulan-score.onrender.com";

    const form = document.getElementById("predict-form");
    const submitBtn = document.getElementById("submit-btn");
    const resetBtn = document.getElementById("reset-btn");
    const errorRetryBtn = document.getElementById("error-retry-btn");

    const stateIdle = document.getElementById("state-idle");
    const stateLoading = document.getElementById("state-loading");
    const stateResult = document.getElementById("state-result");
    const stateError = document.getElementById("state-error");

    const scoreNumberEl = document.getElementById("score-number");
    const scoreBandEl = document.getElementById("score-band");
    const scoreContextEl = document.getElementById("score-context");
    const gaugeFill = document.getElementById("gauge-fill");
    const errorLabelEl = document.getElementById("error-label");
    const errorCopyEl = document.getElementById("error-copy");

    const stressHiddenInput = document.getElementById("stress_level");
    const segGroup = document.getElementById("stress_level_group");

    const GAUGE_ARC_LENGTH = 314.16;

    // Draw gauge tick marks.
    function drawTicks() {
        document.querySelectorAll(".gauge-ticks").forEach((group) => {
            group.innerHTML = "";

            const cx = 120;
            const cy = 140;
            const rOuter = 100;
            const rInner = 90;

            for (let i = 0; i <= 10; i += 2) {
                const angle = Math.PI - (i / 10) * Math.PI;

                const x1 = cx + rOuter * Math.cos(angle);
                const y1 = cy - rOuter * Math.sin(angle);
                const x2 = cx + rInner * Math.cos(angle);
                const y2 = cy - rInner * Math.sin(angle);

                const line = document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "line"
                );

                line.setAttribute("x1", x1.toFixed(1));
                line.setAttribute("y1", y1.toFixed(1));
                line.setAttribute("x2", x2.toFixed(1));
                line.setAttribute("y2", y2.toFixed(1));

                group.appendChild(line);
            }
        });
    }

    drawTicks();

    // Field-level error helpers.
    function fieldWrapper(input) {
        return input.closest(".field");
    }

    function setFieldError(input, message) {
        const wrapper = fieldWrapper(input);
        if (!wrapper) return;

        wrapper.classList.add("field-error");

        const messageEl = wrapper.querySelector(".error-msg");
        if (messageEl) {
            messageEl.textContent = message;
        }
    }

    function clearFieldError(input) {
        const wrapper = fieldWrapper(input);
        if (!wrapper) return;

        wrapper.classList.remove("field-error");

        const messageEl = wrapper.querySelector(".error-msg");
        if (messageEl) {
            messageEl.textContent = "";
        }
    }

    function clearAllErrors() {
        form.querySelectorAll(".field").forEach((field) => {
            field.classList.remove("field-error");
        });

        form.querySelectorAll(".error-msg").forEach((message) => {
            message.textContent = "";
        });
    }

    // Stress level buttons.
    segGroup.querySelectorAll(".seg-btn").forEach((button) => {
        button.addEventListener("click", () => {
            segGroup.querySelectorAll(".seg-btn").forEach((btn) => {
                btn.classList.remove("active");
                btn.setAttribute("aria-pressed", "false");
            });

            button.classList.add("active");
            button.setAttribute("aria-pressed", "true");

            stressHiddenInput.value = button.dataset.value;
            clearFieldError(stressHiddenInput);
        });
    });

    // Convert form values into the JSON expected by FastAPI.
    function collectPayload() {
        const fd = new FormData(form);

        function numberValue(name) {
            const value = fd.get(name);
            return value === null || String(value).trim() === ""
                ? NaN
                : Number(value);
        }

        return {
            age: numberValue("age"),
            gender: fd.get("gender") || "",
            country: (fd.get("country") || "").trim(),
            academic_level: fd.get("academic_level") || "",
            most_used_platform: fd.get("most_used_platform") || "",
            purpose_of_use: fd.get("purpose_of_use") || "",
            avg_daily_usage_hours: numberValue("avg_daily_usage_hours"),
            daily_unlocks: numberValue("daily_unlocks"),
            study_hours: numberValue("study_hours"),
            physical_activity_hours: numberValue("physical_activity_hours"),
            sleep_hours_per_night: numberValue("sleep_hours_per_night"),
            stress_level: stressHiddenInput.value || ""
        };
    }

    // Validate inputs before sending them to the API.
    function validate(payload) {
        const errors = [];

        const numericChecks = [
            ["age", 10, 100, true],
            ["avg_daily_usage_hours", 0, 24, false],
            ["daily_unlocks", 0, Infinity, true],
            ["study_hours", 0, 24, false],
            ["physical_activity_hours", 0, 2, false],
            ["sleep_hours_per_night", 0, 24, false]
        ];

        numericChecks.forEach(([key, min, max, integer]) => {
            const input = document.getElementById(key);
            const value = payload[key];

            if (!Number.isFinite(value)) {
                errors.push([input, "Please enter a valid number."]);
            } else if (value < min || value > max) {
                const range = max === Infinity
                    ? `${min} or more`
                    : `${min} and ${max}`;

                errors.push([input, `Must be between ${range}.`]);
            } else if (integer && !Number.isInteger(value)) {
                errors.push([input, "Please enter a whole number."]);
            }
        });

        const requiredFields = [
            "gender",
            "country",
            "academic_level",
            "most_used_platform",
            "purpose_of_use"
        ];

        requiredFields.forEach((key) => {
            const input = document.getElementById(key);

            if (!payload[key] || !String(payload[key]).trim()) {
                errors.push([input, "This field is required."]);
            }
        });

        if (!payload.stress_level) {
            errors.push([stressHiddenInput, "Please select a stress level."]);
        }

        return errors;
    }

    // Switch between the four result states.
    function showState(name) {
        const states = {
            idle: stateIdle,
            loading: stateLoading,
            result: stateResult,
            error: stateError
        };

        Object.values(states).forEach((element) => {
            element.hidden = true;
        });

        states[name].hidden = false;
    }

    function setSubmitting(isSubmitting) {
        submitBtn.disabled = isSubmitting;
        submitBtn.classList.toggle("loading", isSubmitting);
    }

    // Display the score without assigning a clinical meaning to it.
    function renderResult(score) {
        if (!Number.isFinite(score) || score < 0 || score > 10) {
            renderError(
                "Unexpected response",
                "The API returned a score outside the expected 0–10 range."
            );
            return;
        }

        const clamped = Math.max(0, Math.min(10, score));

        scoreNumberEl.textContent = clamped.toFixed(2);
        scoreBandEl.textContent = "Model prediction";
        scoreContextEl.textContent =
            "This is a model-generated score, not a diagnosis or clinical assessment.";

        gaugeFill.style.transition = "none";
        gaugeFill.style.strokeDashoffset = String(GAUGE_ARC_LENGTH);

        showState("result");

        requestAnimationFrame(() => {
            gaugeFill.style.transition = "";
            const offset = GAUGE_ARC_LENGTH * (1 - clamped / 10);
            gaugeFill.style.strokeDashoffset = String(offset);
        });
    }

    function renderError(label, message) {
        errorLabelEl.textContent = label;
        errorCopyEl.textContent = message;
        showState("error");
    }

    // Show validation errors returned by FastAPI.
    function applyServerValidationErrors(detail) {
        if (!Array.isArray(detail)) return false;

        let matched = false;

        detail.forEach((error) => {
            const field = Array.isArray(error.loc)
                ? error.loc[error.loc.length - 1]
                : null;

            const input = field === "stress_level"
                ? stressHiddenInput
                : document.getElementById(field);

            if (input) {
                setFieldError(input, error.msg || "Invalid value.");
                matched = true;
            }
        });

        return matched;
    }

    // Submit the form to FastAPI.
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearAllErrors();

        const payload = collectPayload();
        const clientErrors = validate(payload);

        if (clientErrors.length > 0) {
            clientErrors.forEach(([input, message]) => {
                if (input) setFieldError(input, message);
            });

            const firstInput = clientErrors[0][0];
            if (firstInput) firstInput.focus();
            return;
        }

        setSubmitting(true);
        showState("loading");

        try {
            const response = await fetch(`${API_BASE}/predict`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (response.status === 422) {
                const body = await response.json().catch(() => null);
                const matched = body &&
                    applyServerValidationErrors(body.detail);

                renderError(
                    "Check your inputs",
                    matched
                        ? "The API rejected some fields. Check the highlighted fields."
                        : "The API rejected the submitted data. Please review your inputs."
                );
                return;
            }

            if (!response.ok) {
                let message = `The server returned HTTP ${response.status}.`;

                const body = await response.json().catch(() => null);
                if (body && typeof body.detail === "string") {
                    message = body.detail;
                }

                renderError("Prediction failed", message);
                return;
            }

            const data = await response.json();

            if (typeof data.predicted_mental_health_score !== "number") {
                renderError(
                    "Unexpected response",
                    "The API responded, but the predicted score is missing or invalid."
                );
                return;
            }

            renderResult(data.predicted_mental_health_score);

        } catch (error) {
            console.error("Prediction request failed:", error);

            renderError(
                "Can't reach the server",
                "Could not connect to the API. Check the API URL, server status and CORS settings."
            );
        } finally {
            setSubmitting(false);
        }
    });

    // Clear field errors when the user edits a field.
    form.querySelectorAll("input, select").forEach((element) => {
        element.addEventListener("input", () => {
            clearFieldError(element);
        });

        element.addEventListener("change", () => {
            clearFieldError(element);
        });
    });

    // Reset the result and form for another prediction.
    function resetForm() {
        form.reset();
        clearAllErrors();

        stressHiddenInput.value = "";

        segGroup.querySelectorAll(".seg-btn").forEach((button) => {
            button.classList.remove("active");
            button.setAttribute("aria-pressed", "false");
        });

        gaugeFill.style.transition = "none";
        gaugeFill.style.strokeDashoffset = String(GAUGE_ARC_LENGTH);

        showState("idle");
    }

    resetBtn.addEventListener("click", resetForm);
    errorRetryBtn.addEventListener("click", () => {
        showState("idle");
    });
})();