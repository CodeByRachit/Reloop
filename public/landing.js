import { extractYouTubeVideoId } from "./youtube.js";

const videoForm = document.getElementById("videoForm");
const videoUrlInput = document.getElementById("videoUrl");
const startLearningButton = document.getElementById("startLearning");
const formMessage = document.getElementById("formMessage");
let isNavigating = false;

if (videoForm && videoUrlInput && startLearningButton) {
 videoUrlInput.addEventListener("input", () => {
 startLearningButton.disabled = !videoUrlInput.value.trim() || isNavigating;
 videoUrlInput.removeAttribute("aria-invalid");
 if (formMessage) {
 formMessage.textContent = "";
 formMessage.classList.remove("is-error");
 }
 });

 videoForm.addEventListener("submit", (event) => {
 event.preventDefault();
 if (isNavigating) return;

 const enteredValue = videoUrlInput.value.trim();
 const videoId = extractYouTubeVideoId(enteredValue);
 if (!videoId) {
 if (formMessage) {
 formMessage.textContent = enteredValue
 ? "Please enter a valid YouTube video link."
 : "Please enter a video link.";
 formMessage.classList.add("is-error");
 }
 videoUrlInput.setAttribute("aria-invalid", "true");
 videoUrlInput.focus();
 return;
 }

 isNavigating = true;
 startLearningButton.disabled = true;
 startLearningButton.classList.add("is-loading");
 startLearningButton.setAttribute("aria-busy", "true");
 if (formMessage) {
 formMessage.textContent = "Opening your study space...";
 formMessage.classList.remove("is-error");
 }

 const destination = new URL("/focus", window.location.origin);
 destination.searchParams.set("videoId", videoId);
 window.location.assign(destination.pathname + destination.search);
 });
}

document.querySelectorAll("[data-go-to-focus]").forEach((link) => {
 link.addEventListener("click", () => window.location.assign("/focus"));
});

const returnToInput = document.getElementById("returnToInput");
if (returnToInput && videoForm && videoUrlInput) {
 returnToInput.addEventListener("click", () => {
 const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
 videoForm.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
 window.setTimeout(() => videoUrlInput.focus({ preventScroll: true }), reduceMotion ? 0 : 350);
 });
}

const copyrightYear = document.getElementById("copyrightYear");
if (copyrightYear) copyrightYear.textContent = String(new Date().getFullYear());

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealElements = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !prefersReducedMotion) {
 const revealObserver = new IntersectionObserver((entries, observer) => {
 entries.forEach((entry) => {
 if (entry.isIntersecting) {
 entry.target.classList.add("is-visible");
 observer.unobserve(entry.target);
 }
 });
 }, { threshold: 0.08, rootMargin: "0px 0px -35px 0px" });

 document.documentElement.classList.add("reveal-ready");
 revealElements.forEach((element) => revealObserver.observe(element));
} else {
 revealElements.forEach((element) => element.classList.add("is-visible"));
}

document.querySelectorAll("a").forEach((link) => {
 link.addEventListener("click", (event) => {
 const targetId = link.getAttribute("href");
 if (!targetId || !targetId.startsWith("#")) return;

 const target = document.querySelector(targetId);
 if (!target) return;

 event.preventDefault();
 window.history.pushState(null, "", targetId);
 target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
 });
});
