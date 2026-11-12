using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using SmartFactory.Services.TelemetryService.Infrastructure.Services;

namespace SmartFactory.Tests;

[Collection("Telemetry delivery")]
public sealed class RenderWorkerHealthTests
{
    [Theory]
    [InlineData("worker", "render-bundle", true)]
    [InlineData("WORKER", "render-bundle", true)]
    [InlineData("all", "render-bundle", false)]
    [InlineData("web", "render-bundle", false)]
    [InlineData(null, "local", true)]
    public void TelemetryHealthEndpointUsesExpectedInterface(string? role, string? mode, bool publicInterface)
    {
        var address = RenderHealthEndpointService.ResolveBindAddress(role, mode);
        Assert.Equal(publicInterface ? IPAddress.Any : IPAddress.Loopback, address);
    }

    [Fact]
    public void ListenerSocketCancellationIsExpectedDuringShutdown()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        Assert.True(RenderHealthEndpointService.IsExpectedListenerShutdown(
            new System.Net.Sockets.SocketException(125), cancellation.Token));
        Assert.True(RenderHealthEndpointService.IsExpectedListenerShutdown(
            new OperationCanceledException(), cancellation.Token));
        Assert.False(RenderHealthEndpointService.IsExpectedListenerShutdown(
            new System.Net.Sockets.SocketException(125), CancellationToken.None));
    }

    [Fact]
    public async Task StoppingAnIdleHealthListenerCompletesItsBackgroundTask()
    {
        var previousPort = Environment.GetEnvironmentVariable("PORT");
        Environment.SetEnvironmentVariable("PORT", "0");
        try
        {
            using var provider = new ServiceCollection().BuildServiceProvider();
            using var subscriber = new MqttTelemetrySubscriberService(provider, new ConfigurationBuilder().Build(),
                Mock.Of<IHostEnvironment>(host => host.EnvironmentName == "Development"),
                NullLogger<MqttTelemetrySubscriberService>.Instance);
            var logger = new Mock<ILogger<RenderHealthEndpointService>>();
            using var service = new RenderHealthEndpointService(subscriber, logger.Object,
                provider.GetRequiredService<IServiceScopeFactory>());
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await service.StartAsync(timeout.Token);
            while (!logger.Invocations.Any(call => call.Arguments.Any(value =>
                value?.ToString()?.StartsWith("Health endpoint listening on port ", StringComparison.Ordinal) == true)))
                await Task.Delay(10, timeout.Token);

            await service.StopAsync(timeout.Token);
            await service.ExecuteTask!.WaitAsync(timeout.Token);
        }
        finally
        {
            Environment.SetEnvironmentVariable("PORT", previousPort);
        }
    }
}
