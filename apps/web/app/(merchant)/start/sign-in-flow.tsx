"use client";

import { ScanFace } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { CODE_LENGTH, CodeInput } from "@/components/ui/code-input";
import { Field } from "@/components/ui/field";
import { Splash } from "@/components/ui/splash";
import { WizardFrame } from "@/components/wizard/wizard-frame";
import { AuthError, useAuth, useRouteGuard } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { useNow } from "@/lib/hooks";
import { journeyProgress } from "@/lib/journey";

const RESEND_AFTER_MS = 30_000;
const emailCheck = z.email();

/**
 * M1: e-mail, then the 6-digit code. The code is sent as soon as the sixth digit is typed, so the
 * Continue button is only there for a retry. Once signed in, the route guard moves on by itself:
 * `/home` for a merchant, `/business` for a new user.
 */
export function SignInFlow(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const { pendingEmail, sendCode, verifyCode, loginWithPasskey, passkeyAvailable } = useAuth();
  const ready = useRouteGuard("anonymous");
  const now = useNow();

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const stage = params.get("step") === "code" && pendingEmail !== null ? "code" : "email";

  // A reload on the code step has lost the address: start again from the first step.
  useEffect(() => {
    if (params.get("step") === "code" && pendingEmail === null && ready) router.replace("/start");
  }, [params, pendingEmail, ready, router]);

  if (!ready) return <Splash />;

  const emailValid = emailCheck.safeParse(email.trim()).success;
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function submitEmail(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    if (sending || passkeyBusy) return;
    if (!emailValid) {
      setEmailError(copy.signIn.invalidEmail);
      return;
    }
    setSending(true);
    setEmailError(undefined);
    try {
      await sendCode(email.trim());
      setCode("");
      setCodeError(false);
      setResendAt(Date.now() + RESEND_AFTER_MS);
      router.push("/start?step=code");
    } catch (error: unknown) {
      setEmailError(error instanceof AuthError ? error.message : copy.common.genericError);
    } finally {
      setSending(false);
    }
  }

  async function submitCode(value: string): Promise<void> {
    if (verifying || value.length !== CODE_LENGTH) return;
    setVerifying(true);
    setCodeError(false);
    try {
      await verifyCode(value);
      // Stay in the loading state: the route guard is about to leave this screen.
    } catch {
      setCode("");
      setCodeError(true);
      setShakeKey((key) => key + 1);
      setVerifying(false);
    }
  }

  async function resend(): Promise<void> {
    if (pendingEmail === null || secondsLeft > 0) return;
    try {
      await sendCode(pendingEmail);
      setResendAt(Date.now() + RESEND_AFTER_MS);
    } catch (error: unknown) {
      setEmailError(error instanceof AuthError ? error.message : copy.common.genericError);
    }
  }

  async function useFaceId(): Promise<void> {
    if (passkeyBusy || sending) return;
    setPasskeyBusy(true);
    setEmailError(undefined);
    try {
      await loginWithPasskey();
    } catch {
      setEmailError(copy.signIn.passkeyFailed);
      setPasskeyBusy(false);
    }
  }

  if (stage === "code") {
    return (
      <WizardFrame
        stepKey="code"
        progress={journeyProgress("code")}
        title={copy.signIn.codeTitle}
        subtitle={
          <>
            {copy.signIn.codeSent(pendingEmail ?? "")} ·{" "}
            <button
              type="button"
              onClick={() => router.replace("/start")}
              className="-my-3 inline-block py-3 text-lime underline underline-offset-4"
            >
              {copy.signIn.change}
            </button>
          </>
        }
        onBack={() => router.replace("/start")}
        footer={
          <Button
            disabled={code.length !== CODE_LENGTH}
            loading={verifying}
            onClick={() => void submitCode(code)}
          >
            {copy.common.continue}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-label uppercase text-text">{copy.signIn.codeLabel}</p>
          <CodeInput
            value={code}
            onChange={(next) => {
              setCode(next);
              setCodeError(false);
            }}
            onComplete={(full) => void submitCode(full)}
            label={copy.signIn.codeLabel}
            error={codeError}
            shakeKey={shakeKey}
            disabled={verifying}
            autoFocus
          />
          {codeError ? (
            <p role="alert" className="px-1 text-caption text-danger">
              {copy.signIn.wrongCode}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={secondsLeft > 0}
          onClick={() => void resend()}
          className="figures -mt-2 h-11 self-start rounded-full px-1 text-body text-muted enabled:text-lime enabled:underline enabled:underline-offset-4"
        >
          {secondsLeft > 0 ? copy.signIn.resendIn(secondsLeft) : copy.signIn.resend}
        </button>
      </WizardFrame>
    );
  }

  return (
    <WizardFrame
      stepKey="email"
      progress={journeyProgress("email")}
      title={copy.signIn.emailTitle}
      subtitle={copy.signIn.emailBody}
      backHref="/"
      footer={
        <Button type="submit" form="sign-in-email" disabled={!emailValid} loading={sending}>
          {copy.common.continue}
        </Button>
      }
    >
      <form id="sign-in-email" onSubmit={(event) => void submitEmail(event)} noValidate>
        <Field
          label={copy.signIn.emailLabel}
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={copy.signIn.emailPlaceholder}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailError(undefined);
          }}
          error={emailError}
          autoFocus
        />
      </form>
      {passkeyAvailable ? (
        <button
          type="button"
          onClick={() => void useFaceId()}
          disabled={passkeyBusy}
          className="-mt-2 inline-flex h-11 items-center gap-2 self-start rounded-full px-1 text-body text-muted transition-colors duration-150 ease-out hover:text-text disabled:opacity-50"
        >
          <ScanFace className="size-5" strokeWidth={1.5} aria-hidden="true" />
          {copy.signIn.faceId}
        </button>
      ) : null}
    </WizardFrame>
  );
}
