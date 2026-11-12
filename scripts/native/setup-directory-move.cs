using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.ExceptionServices;
using System.Threading;

namespace Xuzuo.Setup
{
    internal static class SetupDirectoryMove
    {
        internal const int MaximumMilliseconds = 3000;

        private static bool Retryable(Exception error)
        {
            if (!(error is IOException) && !(error is UnauthorizedAccessException)) return false;
            var hresult = unchecked((uint)error.HResult);
            if ((hresult & 0xffff0000U) != 0x80070000U) return false;
            var code = hresult & 0xffffU;
            return code == 5 || code == 32 || code == 33;
        }

        internal static void Move(string source, string destination, Action validate, Action retrying)
        {
            if (validate == null) throw new ArgumentNullException("validate");
            var clock = Stopwatch.StartNew(); Exception failure = null;
            while (true)
            {
                if (failure != null && clock.ElapsedMilliseconds >= MaximumMilliseconds) ExceptionDispatchInfo.Capture(failure).Throw();
                // A changed owner, reparse point or occupied destination is not a transient lock.
                validate();
                try { Directory.Move(source, destination); return; }
                catch (Exception error) { if (!Retryable(error)) throw; failure = error; }
                var remaining = MaximumMilliseconds - clock.ElapsedMilliseconds;
                if (remaining <= 0) ExceptionDispatchInfo.Capture(failure).Throw();
                if (retrying != null) retrying();
                remaining = MaximumMilliseconds - clock.ElapsedMilliseconds;
                if (remaining <= 0) ExceptionDispatchInfo.Capture(failure).Throw();
                Thread.Sleep((int)Math.Min(100L, remaining));
            }
        }
    }
}
